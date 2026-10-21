import { runAgentTask, type AgentHooks, type ApprovalRequest } from '@/agent/loop'
import { loadModelConfig } from '@/llm/config'
import { KillSwitch } from '@/safety/killSwitch'
import { coreTools } from '@/tools/definitions'
import { ToolRegistry } from '@/tools/registry'
import type { ContentMessage } from '@/types/messages'
import type { TaskEvent } from '@/types/task'
import type { AgentMode } from '@/types/agent'

import { createToolHost } from './host'
import { vault } from './vaultApi'

/**
 * One task at a time, owned by the service worker. The side panel controls
 * it through messages; progress flows back as TaskEvent broadcasts. A
 * periodic alarm keeps the MV3 worker alive while a task runs.
 */

interface ActiveRun {
  kill: KillSwitch
  approvals: Map<string, (approved: boolean) => void>
  questions: Map<string, (answer: string) => void>
}

let active: ActiveRun | null = null

const KEEPALIVE_ALARM = 'navigator-keepalive'

function broadcast(event: TaskEvent): void {
  void chrome.runtime.sendMessage({ source: 'navigator-task', event }).catch(() => {
    // Side panel closed — the loop keeps running; events are lost by design.
  })
}

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab || tab.id === undefined) throw new Error('No active tab found')
  return tab.id
}

/** Points the on-page overlay at the element the agent is about to touch. */
function highlightElement(tabId: number, index: number): void {
  const message: ContentMessage = { kind: 'overlay', highlightIndex: index }
  void chrome.tabs.sendMessage(tabId, message).catch(() => {
    // The tab moved on or has no content script — highlighting is cosmetic.
  })
}

function emitAndHighlight(tabId: number, event: TaskEvent): void {
  broadcast(event)
  if (event.type !== 'action') return
  const index = event.args['index']
  if (typeof index === 'number') highlightElement(tabId, index)
}

export function isTaskRunning(): boolean {
  return active !== null
}

export async function startTask(goal: string, mode: AgentMode): Promise<{ ok: boolean; error?: string }> {
  if (active) return { ok: false, error: 'A task is already running. Stop it first.' }

  let config: Awaited<ReturnType<typeof loadModelConfig>>
  try {
    config = await loadModelConfig()
    const tabId = await getActiveTabId()

    const kill = new KillSwitch()
    const approvals = new Map<string, (approved: boolean) => void>()
    const questions = new Map<string, (answer: string) => void>()
    active = { kill, approvals, questions }
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 })

    const hooks: AgentHooks = {
      emit: (event) => emitAndHighlight(tabId, event),
      requestApproval: (request: ApprovalRequest) =>
        new Promise<boolean>((resolve) => {
          approvals.set(request.id, resolve)
        }),
      askUser: (id, question) =>
        new Promise<string>((resolve) => {
          questions.set(id, resolve)
          void question
        }),
    }

    void runAgentTask({
      goal,
      mode,
      tabId,
      host: createToolHost(),
      registry: new ToolRegistry(coreTools()),
      config,
      hooks,
      signal: kill.signal,
      vault,
    })
      .then((outcome) => {
        broadcast({
          type: 'done',
          success: outcome.success,
          summary: outcome.summary,
          steps: outcome.steps,
          promptTokens: outcome.promptTokens,
          completionTokens: outcome.completionTokens,
        })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        broadcast({ type: 'failed', error: message })
      })
      .finally(() => {
        active = null
        chrome.alarms.clear(KEEPALIVE_ALARM)
      })

    return { ok: true }
  } catch (error) {
    active = null
    chrome.alarms.clear(KEEPALIVE_ALARM)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function stopTask(): { ok: boolean; error?: string } {
  if (!active) return { ok: false, error: 'No task is running.' }
  active.kill.stop()
  for (const resolve of active.approvals.values()) resolve(false)
  for (const resolve of active.questions.values()) resolve('(task stopped)')
  active.approvals.clear()
  active.questions.clear()
  return { ok: true }
}

export function resolveApproval(id: string, approved: boolean): { ok: boolean; error?: string } {
  const resolve = active?.approvals.get(id)
  if (!resolve) return { ok: false, error: 'No pending approval with that id.' }
  active?.approvals.delete(id)
  resolve(approved)
  return { ok: true }
}

export function resolveQuestion(id: string, answer: string): { ok: boolean; error?: string } {
  const resolve = active?.questions.get(id)
  if (!resolve) return { ok: false, error: 'No pending question with that id.' }
  active?.questions.delete(id)
  resolve(answer)
  return { ok: true }
}

/** The MV3 service worker dies when idle; an active alarm resets the timer. */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM && active !== null) {
    // Touching any chrome API extends the lifetime by another minute.
    void chrome.runtime.getPlatformInfo().catch(() => undefined)
  }
})
