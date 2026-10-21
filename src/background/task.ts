import { runAgentTask } from '@/agent/loop'
import { loadModelConfig } from '@/llm/config'
import { coreTools } from '@/tools/definitions'
import { dataTools } from '@/tools/dataTools'
import { tabTools } from '@/tools/tabTools'
import { ToolRegistry } from '@/tools/registry'
import type { ContentMessage } from '@/types/messages'
import type { TaskEvent } from '@/types/task'
import type { AgentMode } from '@/types/agent'

import { createAuditProbe } from './auditApi'
import { createTabOps } from './tabApi'
import { memoryApi } from './memoryApi'
import { createToolHost } from './host'
import { beginRun, endRun, hooksFor, isRunActive, resolveApproval, resolveQuestion, stopRun } from './runControl'
import { vault } from './vaultApi'

/**
 * One task at a time, owned by the service worker. The side panel controls
 * it through messages; progress flows back as TaskEvent broadcasts. A
 * periodic alarm keeps the MV3 worker alive while a task runs.
 */

const KEEPALIVE_ALARM = 'navigator-keepalive'

export function broadcast(event: TaskEvent): void {
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
  return isRunActive()
}

export async function startTask(goal: string, mode: AgentMode): Promise<{ ok: boolean; error?: string }> {
  let config: Awaited<ReturnType<typeof loadModelConfig>>
  let tabId: number
  try {
    config = await loadModelConfig()
    tabId = await getActiveTabId()
    const run = beginRun('task')
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 })
    const hooks = hooksFor((event) => emitAndHighlight(tabId, event))
    const runId = crypto.randomUUID()

    void runAgentTask({
      goal,
      mode,
      tabId,
      host: createToolHost(),
      registry: new ToolRegistry([...coreTools(), ...tabTools(), ...dataTools()]),
      config,
      hooks,
      signal: run.kill.signal,
      vault,
      tabs: await createTabOps(),
      memory: memoryApi,
      runId,
      probe: createAuditProbe(tabId),
    })
      .then((outcome) => {
        broadcast({
          type: 'done',
          runId,
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
        endRun()
        chrome.alarms.clear(KEEPALIVE_ALARM)
      })

    return { ok: true }
  } catch (error) {
    endRun()
    chrome.alarms.clear(KEEPALIVE_ALARM)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The MV3 service worker dies when idle; an active alarm resets the timer. */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM && isRunActive()) {
    // Touching any chrome API extends the lifetime by another minute.
    void chrome.runtime.getPlatformInfo().catch(() => undefined)
  }
})
