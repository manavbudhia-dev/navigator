import { complete } from '@/llm'
import { buildSystemPrompt } from '@/prompts/system'
import { sanitizeUntrusted } from '@/prompts/sanitize'
import { recordAudit } from '@/safety/audit'
import { assessRisk } from '@/safety/risk'
import { decide } from '@/safety/modePolicy'

import { ActionQueue } from './queue'
import { compactHistory, estimateMessagesTokens } from './compact'
import { findElementInfo } from './elementLines'

import type { ModelConfig } from '@/llm/config'
import type { ChatMessage, CompletionRequest, CompletionResult, TokenUsage } from '@/llm/types'
import type { AuditInput } from '@/safety/audit'
import type { AgentMode } from '@/types/agent'
import type { TaskEvent } from '@/types/task'
import type { ToolContext, ToolHost, TabOps, VaultAccess } from '@/tools/types'
import type { ToolRegistry } from '@/tools/registry'
import type { RiskLevel } from '@/safety/risk'

/**
 * The two-tier agent loop (spec §5). The big model plans one tool call per
 * turn; the executor validates it, risk-scores it, gates it through the
 * mode policy (asking the user when required), runs it through the
 * serialized queue, and feeds the sanitized result back.
 */

export interface ApprovalRequest {
  id: string
  tool: string
  args: Record<string, unknown>
  summary: string
  level: RiskLevel
  reasons: string[]
  hardBlock: string | null
}

export interface AgentHooks {
  emit(event: TaskEvent): void
  /** Resolves when the user answers; false = denied. */
  requestApproval(request: ApprovalRequest): Promise<boolean>
  /** ask_user tool: resolves with the typed answer. */
  askUser(id: string, question: string): Promise<string>
}

export interface AgentOutcome {
  success: boolean
  summary: string
  steps: number
  promptTokens: number
  completionTokens: number
}

/** Injectable for tests: same shape as llm/complete. */
export type CompleteFn = (
  request: CompletionRequest,
  config: ModelConfig,
  options: { kind?: 'big' | 'small'; signal?: AbortSignal },
) => Promise<CompletionResult>

/**
 * What the page looked like around an action, for the audit log (spec §9).
 * Injected by the service worker — the loop stays Chrome-free and testable.
 * Implementations must never throw: a missing screenshot is not worth a
 * failed task.
 */
export interface AuditProbe {
  url(): Promise<string | null>
  thumb(): Promise<string | null>
}

export interface AgentRunOptions {
  goal: string
  mode: AgentMode
  tabId: number
  host: ToolHost
  registry: ToolRegistry
  config: ModelConfig
  hooks: AgentHooks
  signal: AbortSignal
  /** Passed straight to tools that need it (fill_form). */
  vault?: VaultAccess
  /** Passed straight to the tab tools (spec §8). */
  tabs?: TabOps
  /** Shared by every audit row this run writes (spec §9). */
  runId?: string
  /** Where the action happened and what it looked like afterwards (spec §9). */
  probe?: AuditProbe
  maxSteps?: number
  completeFn?: CompleteFn
  newId?: () => string
}

const ELEMENT_LINE = /^\[\d+\]</

function summarizeArgs(tool: string, args: Record<string, unknown>): string {
  if (tool === 'click') return `click element ${String(args['index'])}`
  if (tool === 'type_text') return `type "${String(args['text'])}" into ${String(args['index'])}`
  if (tool === 'navigate') return `open ${String(args['url'])}`
  if (tool === 'scroll') return `scroll ${String(args['direction'])}`
  return `${tool} ${JSON.stringify(args)}`
}

function transcriptFor(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const calls = m.toolCalls?.map((c) => ` -> ${c.name}(${c.arguments})`).join('') ?? ''
      return `${m.role}${calls}: ${(m.content ?? '').slice(0, 400)}`
    })
    .join('\n')
}

function countTrailingStreak(signatures: string[]): number {
  if (signatures.length === 0) return 0
  const last = signatures[signatures.length - 1]!
  let streak = 0
  for (let i = signatures.length - 1; i >= 0 && signatures[i] === last; i -= 1) streak += 1
  return streak
}

/** Audit extras come from Chrome and can fail; a page that will not answer is left out of the log rather than allowed to fail the task. */
async function bestEffort(read: (() => Promise<string | null>) | null): Promise<string | null> {
  if (read === null) return null
  try {
    return await read()
  } catch {
    return null
  }
}

export async function runAgentTask(options: AgentRunOptions): Promise<AgentOutcome> {
  const { goal, mode, tabId, host, registry, config, hooks, signal } = options
  const completeFn: CompleteFn = options.completeFn ?? complete
  const newId = options.newId ?? (() => Math.random().toString(36).slice(2, 10))
  const maxSteps = options.maxSteps ?? 40
  const probe = options.probe
  const readUrl = probe === undefined ? null : (): Promise<string | null> => probe.url()
  const readThumb = probe === undefined ? null : (): Promise<string | null> => probe.thumb()
  const queue = new ActionQueue()
  const ctx: ToolContext = {
    host,
    tabId,
    signal,
    ...(options.vault ? { vault: options.vault } : {}),
    ...(options.tabs ? { tabs: options.tabs } : {}),
    complete: async (messages, kind) => {
      const result = await completeFn(
        { messages, ...(kind === 'small' ? { maxTokens: 512 } : {}) },
        config,
        { kind, signal },
      )
      // Judgement calls made inside tools are real spend too (spec §12).
      account(result.usage)
      return result
    },
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(mode) },
    {
      role: 'user',
      content: `Goal: ${goal}\nCall read_page to see the current page, then work toward the goal step by step.`,
    },
  ]

  let pageLines: string[] = []
  let promptTokens = 0
  let completionTokens = 0
  let steps = 0
  const recentSignatures: string[] = []
  let nudges = 0

  const pushToolResult = (callId: string, name: string, content: string): void => {
    messages.push({ role: 'tool', content, toolCallId: callId, name })
  }

  /** The parts of an audit row that only Chrome and the provider know (spec §9). */
  const evidence = async (): Promise<Pick<AuditInput, 'runId' | 'url'>> => {
    const out: Pick<AuditInput, 'runId' | 'url'> = {}
    if (options.runId !== undefined) out.runId = options.runId
    const url = await bestEffort(readUrl)
    if (url !== null) out.url = url
    return out
  }

  let uncharged: TokenUsage = { promptTokens: 0, completionTokens: 0 }

  const account = (usage: TokenUsage): void => {
    promptTokens += usage.promptTokens
    completionTokens += usage.completionTokens
    uncharged = {
      promptTokens: uncharged.promptTokens + usage.promptTokens,
      completionTokens: uncharged.completionTokens + usage.completionTokens,
    }
  }

  // One LLM turn can ask for several actions; its tokens are charged to the
  // first row of that turn, so summing the log equals what the run cost.
  const chargeTokens = (): TokenUsage => {
    const charge = uncharged
    uncharged = { promptTokens: 0, completionTokens: 0 }
    return charge
  }

  for (let step = 1; step <= maxSteps; step += 1) {
    if (signal.aborted) throw new Error('Navigator was stopped by the user.')
    steps = step
    hooks.emit({ type: 'step', n: step })

    const compacted = await compactHistory(messages, {
      contextWindow: config.contextWindow,
      keep: 8,
      summarize: async (old) => {
        const result = await completeFn(
          {
            messages: [
              {
                role: 'system',
                content: 'Compress this agent transcript into at most 10 numbered notes of what has been done and what was learned. Keep URLs, indices and outcomes.',
              },
              { role: 'user', content: transcriptFor(old) },
            ],
            maxTokens: 512,
          },
          config,
          { kind: 'small', signal },
        )
        account(result.usage)
        return result.message.content ?? '(empty summary)'
      },
    })
    if (compacted.compacted) {
      messages.length = 0
      messages.push(...compacted.messages)
      hooks.emit({ type: 'note', text: 'History compacted to stay within the context window.' })
    }

    const result = await completeFn({ messages, tools: registry.toToolDefinitions() }, config, { signal })
    account(result.usage)

    const assistant = result.message
    if (assistant.content) hooks.emit({ type: 'thinking', text: assistant.content })

    const calls = assistant.toolCalls ?? []
    if (calls.length === 0) {
      nudges += 1
      if (nudges > 2) {
        return { success: false, summary: 'The model stopped using tools without finishing the task.', steps, promptTokens, completionTokens }
      }
      messages.push({ role: 'user', content: 'Call a tool (read_page if unsure), or finish.' })
      continue
    }
    nudges = 0
    messages.push(assistant)

    for (const call of calls) {
      const spec = registry.get(call.name)
      if (!spec) {
        pushToolResult(call.id, call.name, `Unknown tool "${call.name}". Use one of: ${registry.list().map((s) => s.name).join(', ')}`)
        continue
      }

      let rawArgs: Record<string, unknown> = {}
      if (call.arguments.trim() !== '') {
        try {
          const parsedJson = JSON.parse(call.arguments) as unknown
          if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
            throw new Error('arguments must be a JSON object')
          }
          rawArgs = parsedJson as Record<string, unknown>
        } catch (error) {
          pushToolResult(call.id, call.name, `Malformed arguments: ${error instanceof Error ? error.message : String(error)}`)
          continue
        }
      }

      const validated = registry.parseArgs(call.name, rawArgs)
      if (!validated.ok) {
        pushToolResult(call.id, call.name, validated.error)
        continue
      }
      const args = validated.args as Record<string, unknown>

      if (call.name === 'finish') {
        const success = args['success'] === true
        const summary = String(args['summary'] ?? '')
        await recordAudit({
          goal,
          tool: 'finish',
          args,
          risk: 'safe',
          hardBlock: null,
          decision: 'allow',
          ok: success,
          detail: summary,
          ...(await evidence()),
          ...chargeTokens(),
        })
        return { success, summary, steps, promptTokens, completionTokens }
      }

      if (call.name === 'ask_user') {
        const id = newId()
        const question = String(args['question'] ?? '')
        hooks.emit({ type: 'question', id, question })
        const answer = await hooks.askUser(id, question)
        pushToolResult(call.id, call.name, `The user answered: ${answer}`)
        await recordAudit({
          goal,
          tool: 'ask_user',
          args,
          risk: 'safe',
          hardBlock: null,
          decision: 'allow',
          ok: null,
          detail: answer,
          ...(await evidence()),
          ...chargeTokens(),
        })
        continue
      }

      // --- safety gate -----------------------------------------------------
      const element =
        typeof args['index'] === 'number' ? findElementInfo(pageLines, args['index']) : null
      const assessment = assessRisk({
        tool: call.name,
        kind: spec.kind,
        element,
      })
      const decision = decide(mode, spec.kind, assessment)
      const actionSummary = summarizeArgs(call.name, args)
      hooks.emit({ type: 'action', id: call.id, tool: call.name, args, summary: actionSummary })

      if (decision === 'block') {
        const reason = `Blocked by ${mode} mode (${assessment.level} risk).`
        hooks.emit({ type: 'blocked', tool: call.name, reason })
        await recordAudit({
          goal,
          tool: call.name,
          args,
          risk: assessment.level,
          hardBlock: assessment.hardBlock,
          decision: 'block',
          ok: false,
          detail: reason,
          ...(await evidence()),
          ...chargeTokens(),
        })
        pushToolResult(call.id, call.name, reason + ' Do not retry write actions in this mode.')
        continue
      }

      if (decision === 'require-approval') {
        const id = newId()
        hooks.emit({ type: 'approval', id, tool: call.name, args, summary: actionSummary, level: assessment.level, reasons: assessment.reasons, hardBlock: assessment.hardBlock })
        const approved = await hooks.requestApproval({
          id,
          tool: call.name,
          args,
          summary: actionSummary,
          level: assessment.level,
          reasons: assessment.reasons,
          hardBlock: assessment.hardBlock,
        })
        hooks.emit({ type: 'approval-resolved', id, approved })
        if (!approved) {
          await recordAudit({
            goal,
            tool: call.name,
            args,
            risk: assessment.level,
            hardBlock: assessment.hardBlock,
            decision: 'denied',
            ok: false,
            detail: 'User denied.',
            ...(await evidence()),
            ...chargeTokens(),
          })
          pushToolResult(call.id, call.name, 'The user denied this action. Choose a different approach or ask_user.')
          continue
        }
      }

      // --- execute ---------------------------------------------------------
      // The url is read before the action because a click or navigate is about
      // to change it; the picture is taken after, because it shows the result.
      const where = await evidence()
      const startedAt = Date.now()
      const toolResult = await queue.enqueue(() => registry.execute(call.name, args, ctx))
      const ms = Date.now() - startedAt
      let content = toolResult.content
      if (call.name === 'read_page' && toolResult.ok) {
        pageLines = content.split('\n').filter((line) => ELEMENT_LINE.test(line))
        const sanitized = sanitizeUntrusted(content)
        content = sanitized.text
        if (sanitized.flags.length > 0) {
          hooks.emit({ type: 'note', text: `Prompt-injection patterns redacted from page (${sanitized.flags.length}).` })
        }
      }

      hooks.emit({ type: 'result', tool: call.name, ok: toolResult.ok, content })
      // Only an action that could change the page is worth a picture of it (spec §12).
      const thumb = spec.kind === 'read' ? null : await bestEffort(readThumb)
      await recordAudit({
        goal,
        tool: call.name,
        args,
        risk: assessment.level,
        hardBlock: assessment.hardBlock,
        decision: decision === 'allow' ? 'allow' : 'approved',
        ok: toolResult.ok,
        detail: content.slice(0, 500),
        ...where,
        ...(thumb === null ? {} : { thumb }),
        ...(toolResult.target === undefined ? {} : { target: toolResult.target }),
        ms,
        ...chargeTokens(),
      })
      pushToolResult(call.id, call.name, content)

      // --- loop detection ---------------------------------------------------
      recentSignatures.push(`${call.name}:${JSON.stringify(args)}`)
      if (recentSignatures.length > 8) recentSignatures.shift()
      const streak = countTrailingStreak(recentSignatures)
      if (streak === 3) {
        messages.push({
          role: 'user',
          content: 'You have repeated the exact same action 3 times. It is not working. Change strategy: re-read the page, try a different element, or call ask_user.',
        })
        hooks.emit({ type: 'note', text: 'Loop warning: the same action keeps repeating.' })
      }
      if (streak >= 5) {
        return {
          success: false,
          summary: 'Stopped: the agent kept repeating the same action without progress.',
          steps,
          promptTokens,
          completionTokens,
        }
      }
    }
  }

  return {
    success: false,
    summary: `Stopped after the ${maxSteps}-step limit without calling finish.`,
    steps,
    promptTokens,
    completionTokens,
  }
}
