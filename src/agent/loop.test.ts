import { describe, expect, it, vi } from 'vitest'

import { coreTools } from '@/tools/definitions'
import { dataTools } from '@/tools/dataTools'
import { ToolRegistry } from '@/tools/registry'
import { stubChromeHost } from '@/tools/testUtils'
import type { AuditInput } from '@/safety/audit'
import type { ModelConfig } from '@/llm/config'
import type { CompletionRequest, CompletionResult } from '@/llm/types'
import type { PageState } from '@/types/pageState'
import type { AgentMode } from '@/types/agent'
import type { TaskEvent } from '@/types/task'
import type { ToolHost, ToolSpec } from '@/tools/types'

import { recordAudit } from '@/safety/audit'
import { runAgentTask, type AgentHooks, type ApprovalRequest, type AuditProbe, type CompleteFn } from './loop'

vi.mock('@/safety/audit', () => ({
  recordAudit: vi.fn(async (input: AuditInput) => ({ at: 0, ...input })),
}))

const config: ModelConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  apiKey: '',
  modelName: 'test-model',
  smallModelName: 'test-small',
  temperature: 0.2,
  maxTokens: 1024,
  contextWindow: 32_000,
}

const PAGE_LINES = [
  '[0]<a href="/home">Home</a>',
  '[1]<button type="submit">Send</button>',
  '[2]<input type="password" name="password"></input>',
  '[3]<button type="button">Proceed to Payment</button>',
]

function fakePageState(): PageState {
  return {
    url: 'https://shop.test/checkout',
    title: 'Checkout',
    readyState: 'complete',
    scrollPercent: 0,
    pageHeightPx: 900,
    viewport: { width: 800, height: 600 },
    loginState: 'unknown',
    elementLines: PAGE_LINES,
    elementCount: PAGE_LINES.length,
    inViewportCount: PAGE_LINES.length,
    markdown: '# Checkout total $40',
    truncatedElements: false,
    truncatedMarkdown: false,
    tokenEstimate: 60,
    capturedAt: 0,
  }
}

function makeHost() {
  const acts: string[] = []
  const host: ToolHost = {
    async pageState() {
      return fakePageState()
    },
    async act(_tabId, action) {
      acts.push(`${action.type}:${'index' in action ? action.index : ''}`)
      return { ok: true, detail: `did ${action.type}` }
    },
    async navigate() {},
    async openTab() {
      return 1
    },
    async sleep() {},
    async formFields() {
      return []
    },
    review() {},
    async locate() {
      return null
    },
    ...stubChromeHost(),
  }
  return { host, acts }
}

let callSeq = 0

function toolCall(name: string, args: Record<string, unknown>): CompletionResult {
  callSeq += 1
  return {
    message: {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: `call_${callSeq}`, name, arguments: JSON.stringify(args) }],
    },
    usage: { promptTokens: 50, completionTokens: 10 },
    finishReason: 'tool_calls',
  }
}

function textReply(text: string): CompletionResult {
  return {
    message: { role: 'assistant', content: text },
    usage: { promptTokens: 50, completionTokens: 10 },
    finishReason: 'stop',
  }
}

function scriptedFn(turns: CompletionResult[]): CompleteFn & { requests: CompletionRequest[] } {
  const fn = Object.assign(
    async (request: CompletionRequest): Promise<CompletionResult> => {
      fn.requests.push(request)
      const next = turns.shift()
      if (!next) throw new Error('scripted LLM ran out of turns')
      return next
    },
    { requests: [] as CompletionRequest[] },
  )
  return fn
}

function makeHooks(approve = true, answer = 'the answer') {
  const events: TaskEvent[] = []
  const approvals: ApprovalRequest[] = []
  const questions: string[] = []
  const hooks: AgentHooks = {
    emit: (event) => events.push(event),
    requestApproval: async (request) => {
      approvals.push(request)
      return approve
    },
    askUser: async (_id, question) => {
      questions.push(question)
      return answer
    },
  }
  return { hooks, events, approvals, questions }
}

function run(
  turns: CompletionResult[],
  mode: AgentMode,
  approve = true,
  evidence: { runId?: string; probe?: AuditProbe; tools?: ToolSpec[]; autoAllow?: readonly string[] } = {},
) {
  const { host, acts } = makeHost()
  const { hooks, events, approvals, questions } = makeHooks(approve)
  const fn = scriptedFn(turns)
  const controller = new AbortController()
  const promise = runAgentTask({
    goal: 'finish the checkout',
    mode,
    tabId: 1,
    host,
    registry: new ToolRegistry(evidence.tools ?? coreTools()),
    config,
    hooks,
    signal: controller.signal,
    ...evidence,
    completeFn: fn,
    maxSteps: 12,
  })
  return { promise, fn, events, approvals, questions, acts, controller }
}

function auditRows(): AuditInput[] {
  return vi.mocked(recordAudit).mock.calls.map(([input]) => input)
}

function toolMessages(fn: CompleteFn & { requests: CompletionRequest[] }): string[] {
  const last = fn.requests[fn.requests.length - 1]
  return (last?.messages ?? []).filter((m) => m.role === 'tool').map((m) => m.content ?? '')
}

describe('runAgentTask', () => {
  it('runs read_page, click, then finish and reports success', async () => {
    const { promise, fn, acts, events } = run(
      [toolCall('read_page', {}), toolCall('click', { index: 1 }), toolCall('finish', { success: true, summary: 'sent it' })],
      'auto',
    )
    const outcome = await promise

    expect(outcome.success).toBe(true)
    expect(outcome.summary).toBe('sent it')
    expect(acts).toEqual(['click:1'])
    expect(outcome.promptTokens).toBeGreaterThan(0)
    expect(events.some((e) => e.type === 'result' && e.ok)).toBe(true)

    // The click result was fed back to the model.
    expect(toolMessages(fn).some((c) => c.includes('did click'))).toBe(true)
  })

  it('wraps page content in the untrusted fence before the model sees it', async () => {
    const { fn, promise } = run(
      [toolCall('read_page', {}), toolCall('finish', { success: true, summary: 'done' })],
      'auto',
    )
    await promise
    const readRequest = fn.requests[1]!
    const readResult = readRequest.messages.find((m) => m.role === 'tool')!
    expect(readResult.content).toContain('UNTRUSTED')
    expect(readResult.content).toContain('# Checkout total $40')
  })

  it('asks for approval in copilot mode and proceeds when allowed', async () => {
    const { promise, approvals, acts } = run(
      [toolCall('read_page', {}), toolCall('click', { index: 1 }), toolCall('finish', { success: true, summary: 'ok' })],
      'copilot',
      true,
    )
    const outcome = await promise
    expect(outcome.success).toBe(true)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]!.tool).toBe('click')
    expect(acts).toEqual(['click:1'])
  })

  it('auto mode asks first on a site the user has not allowed', async () => {
    const probe: AuditProbe = { url: async () => 'https://other.test/cart', thumb: async () => null }
    const { promise, approvals, acts } = run(
      [toolCall('read_page', {}), toolCall('click', { index: 0 }), toolCall('finish', { success: true, summary: 'ok' })],
      'auto',
      true,
      { probe, autoAllow: ['shop.test'] },
    )
    const outcome = await promise
    expect(outcome.success).toBe(true)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]!.reasons.join(' ')).toContain('other.test')
    expect(acts).toEqual(['click:0'])
  })

  it('auto mode acts alone on an allowed site, and on anything under it', async () => {
    const probe: AuditProbe = { url: async () => 'https://eu.shop.test/orders', thumb: async () => null }
    const { promise, approvals, acts } = run(
      [toolCall('read_page', {}), toolCall('click', { index: 0 }), toolCall('finish', { success: true, summary: 'ok' })],
      'auto',
      true,
      { probe, autoAllow: ['shop.test'] },
    )
    await promise
    expect(approvals).toHaveLength(0)
    expect(acts).toEqual(['click:0'])
  })

  it('keeps a typed secret out of the timeline, the card and the audit', async () => {
    vi.mocked(recordAudit).mockClear()
    const { promise, events, approvals, acts } = run(
      [
        toolCall('read_page', {}),
        toolCall('type_text', { index: 2, text: 'hunter2' }),
        toolCall('finish', { success: true, summary: 'ok' }),
      ],
      'copilot',
      true,
    )
    await promise

    expect(approvals).toHaveLength(1)
    expect(approvals[0]!.summary).toContain('[not shown]')
    expect(approvals[0]!.summary).not.toContain('hunter2')
    expect(JSON.stringify(approvals[0]!.args)).not.toContain('hunter2')

    const action = events.find((e): e is Extract<TaskEvent, { type: 'action' }> => e.type === 'action' && e.tool === 'type_text')
    expect(action).toBeDefined()
    expect(action!.summary).toContain('[not shown]')
    expect(JSON.stringify(action!.args)).not.toContain('hunter2')

    // The real value still reaches the page, only the copies are censored.
    expect(acts).toEqual(['type:2'])
    const rows = auditRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(JSON.stringify(rows)).not.toContain('hunter2')
  })

  it('feeds a denial back to the model and does not execute', async () => {
    const { promise, acts, fn } = run(
      [toolCall('click', { index: 1 }), toolCall('finish', { success: false, summary: 'user said no' })],
      'copilot',
      false,
    )
    const outcome = await promise
    expect(acts).toEqual([])
    expect(outcome.success).toBe(false)
    void fn
  })

  it('blocks every write in observe mode', async () => {
    const { promise, acts, events } = run(
      [toolCall('click', { index: 1 }), toolCall('finish', { success: false, summary: 'cannot act' })],
      'observe',
    )
    await promise
    expect(acts).toEqual([])
    expect(events.some((e) => e.type === 'blocked')).toBe(true)
  })

  it('hard-blocks a payment button even in auto mode', async () => {
    const { promise, approvals, acts } = run(
      [toolCall('read_page', {}), toolCall('click', { index: 3 }), toolCall('finish', { success: false, summary: 'blocked' })],
      'auto',
      false,
    )
    await promise
    expect(approvals).toHaveLength(1)
    expect(approvals[0]!.hardBlock).toBe('payment')
    expect(acts).toEqual([])
  })

  it('scores a drag against the control it lands on', async () => {
    const { promise, approvals, acts } = run(
      [
        toolCall('read_page', {}),
        toolCall('drag_and_drop', { from_index: 1, to_index: 3 }),
        toolCall('finish', { success: false, summary: 'blocked' }),
      ],
      'auto',
      false,
    )
    await promise
    expect(approvals[0]!.hardBlock).toBe('payment')
    expect(acts).toEqual([])
  })

  it('refuses an element index the model never read on this page', async () => {
    const { promise, acts, events, fn } = run(
      [toolCall('click', { index: 1 }), toolCall('finish', { success: true, summary: 'gave up' })],
      'auto',
    )
    await promise
    expect(acts).toEqual([])
    expect(events.some((event) => event.type === 'blocked')).toBe(true)
    expect(toolMessages(fn).some((content) => content.includes('Call read_page'))).toBe(true)
  })

  it('drops the element map when an action navigates away', async () => {
    const { promise, acts } = run(
      [
        toolCall('read_page', {}),
        toolCall('navigate', { url: 'https://shop.test/other' }),
        toolCall('click', { index: 1 }),
        toolCall('finish', { success: true, summary: 'done' }),
      ],
      'auto',
    )
    await promise
    expect(acts).toEqual([])
  })

  it('says what a new verb is about to do in the approval card', async () => {
    const { promise, events } = run(
      [
        toolCall('read_page', {}),
        toolCall('upload_file', { index: 2, file_ref: 'resume.pdf' }),
        toolCall('finish', { success: false, summary: 'asked' }),
      ],
      'copilot',
      false,
    )
    await promise
    const action = events.filter((event) => event.type === 'action').at(-1)
    if (action?.type !== 'action') throw new Error('no action event')
    expect(action.summary).toBe('attach "resume.pdf" to file input 2')
  })

  it('detects a stuck loop and stops', async () => {
    const same = toolCall('click', { index: 1 })
    const { promise } = run(
      [
        toolCall('read_page', {}),
        same, same, same, same, same,
        toolCall('finish', { success: true, summary: 'never reached' }),
      ],
      'auto',
    )
    const outcome = await promise
    expect(outcome.success).toBe(false)
    expect(outcome.summary).toContain('repeating')
  })

  it('routes ask_user to the hooks and feeds the answer back', async () => {
    const { promise, questions, fn } = run(
      [toolCall('ask_user', { question: 'Which size?' }), toolCall('finish', { success: true, summary: 'asked' })],
      'auto',
    )
    await promise
    expect(questions).toEqual(['Which size?'])
    expect(toolMessages(fn).some((c) => c.includes('The user answered:'))).toBe(true)
  })

  it('rejects malformed arguments without executing', async () => {
    const bad = {
      message: {
        role: 'assistant' as const,
        content: null,
        toolCalls: [{ id: 'c1', name: 'click', arguments: '{"index": "one"}' }],
      },
      usage: { promptTokens: 5, completionTokens: 5 },
      finishReason: 'tool_calls',
    }
    const { promise, acts } = run(
      [bad, toolCall('finish', { success: false, summary: 'gave up' })],
      'auto',
    )
    await promise
    expect(acts).toEqual([])
  })

  it('nudges a model that stops using tools and then gives up', async () => {
    const { promise } = run([textReply('I am thinking'), textReply('still thinking'), textReply('nope')], 'auto')
    const outcome = await promise
    expect(outcome.success).toBe(false)
    expect(outcome.summary).toContain('stopped using tools')
  })

  it('stops immediately when the kill switch trips', async () => {
    const { promise, controller } = run([toolCall('read_page', {})], 'auto')
    controller.abort(new Error('user stop'))
    await expect(promise).rejects.toThrow()
  })

  it('writes the evidence the audit log exists for: run, page, duration, picture, cost', async () => {
    vi.mocked(recordAudit).mockClear()
    const probe: AuditProbe = {
      url: async () => 'https://shop.test/checkout',
      thumb: async () => 'data:image/jpeg;base64,AAA',
    }
    const { promise } = run(
      [
        toolCall('read_page', {}),
        toolCall('click', { index: 1 }),
        toolCall('finish', { success: true, summary: 'sent it' }),
      ],
      'auto',
      true,
      { runId: 'run-7', probe },
    )
    const outcome = await promise
    const rows = auditRows()

    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.runId === 'run-7')).toBe(true)
    expect(rows.every((row) => row.url === 'https://shop.test/checkout')).toBe(true)

    const click = rows.find((row) => row.tool === 'click')!
    expect(click.thumb).toBe('data:image/jpeg;base64,AAA')
    expect(typeof click.ms).toBe('number')
    // A read leaves the page as it was, so a picture of it proves nothing.
    expect(rows.find((row) => row.tool === 'read_page')!.thumb).toBeUndefined()

    // One charge per LLM turn, so summing the log equals what the run cost.
    expect(rows.reduce((sum, row) => sum + (row.promptTokens ?? 0), 0)).toBe(outcome.promptTokens)
    expect(rows.reduce((sum, row) => sum + (row.completionTokens ?? 0), 0)).toBe(outcome.completionTokens)
  })

  it('finishes the task even when Chrome refuses to answer the probe', async () => {
    vi.mocked(recordAudit).mockClear()
    const probe: AuditProbe = {
      url: async () => {
        throw new Error('tab is gone')
      },
      thumb: async () => {
        throw new Error('capture refused')
      },
    }
    const { promise } = run(
      [toolCall('click', { index: 1 }), toolCall('finish', { success: true, summary: 'done' })],
      'auto',
      true,
      { probe },
    )
    const outcome = await promise
    expect(outcome.success).toBe(true)
    expect(auditRows().every((row) => row.url === undefined && row.thumb === undefined)).toBe(true)
  })

  it('asks before a file lands on the disk, even in Auto mode', async () => {
    vi.mocked(recordAudit).mockClear()
    const { promise, approvals } = run(
      [
        toolCall('download_file', { url: 'https://example.com/invoice.pdf' }),
        toolCall('finish', { success: true, summary: 'fetched it' }),
      ],
      'auto',
      true,
      { tools: [...coreTools(), ...dataTools()] },
    )
    await promise
    expect(approvals).toHaveLength(1)
    expect(approvals[0]!.level).toBe('high')
    expect(approvals[0]!.summary).toBe('download https://example.com/invoice.pdf into Downloads/Navigator')
  })

  it('keeps the picture from a screenshot as the evidence for that step', async () => {
    vi.mocked(recordAudit).mockClear()
    const probe: AuditProbe = {
      url: async () => 'https://shop.test/checkout',
      thumb: async () => 'data:image/jpeg;base64,PROBE',
    }
    const { promise } = run(
      [toolCall('screenshot', {}), toolCall('finish', { success: true, summary: 'looked at it' })],
      'auto',
      true,
      { probe, tools: [...coreTools(), ...dataTools()] },
    )
    await promise
    // The tab's own capture wins over the routine audit thumbnail.
    expect(auditRows().find((row) => row.tool === 'screenshot')!.thumb).toBe('data:image/jpeg;base64,AAAA')
  })
})
