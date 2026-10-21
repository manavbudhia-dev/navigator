import { complete } from '@/llm'
import { loadModelConfig } from '@/llm/config'
import { buildFollowupMessages } from '@/prompts/research'
import { runResearch } from '@/research/engine'
import { buildFollowupContext } from '@/research/retrieve'
import { citationNumbers } from '@/research/citations'
import { loadResearchResult, loadTabConcurrency, saveResearchResult } from '@/research/store'
import { KillSwitch } from '@/safety/killSwitch'
import type { ResearchDepth, ResearchEvent, ResearchEventMessage } from '@/research/types'

import { createResearchHost } from './researchHost'

/**
 * Research runs are owned by the service worker, one at a time, exactly like
 * agent tasks: progress leaves as broadcast ResearchEvents, the report is
 * persisted when it finishes, and Stop closes every background tab still open.
 */

interface ActiveResearch {
  kill: KillSwitch
  dispose: () => Promise<void>
}

let active: ActiveResearch | null = null

const KEEPALIVE_ALARM = 'navigator-research-keepalive'

function broadcast(event: ResearchEvent): void {
  const message: ResearchEventMessage = { source: 'navigator-research', event }
  void chrome.runtime.sendMessage(message).catch(() => {
    // Panel closed — the run continues; events are lost by design.
  })
}

export function isResearchRunning(): boolean {
  return active !== null
}

export async function startResearch(
  question: string,
  depth: ResearchDepth,
): Promise<{ ok: boolean; error?: string }> {
  if (active !== null) return { ok: false, error: 'A research run is already in progress. Stop it first.' }

  const kill = new KillSwitch()
  const host = createResearchHost()
  active = { kill, dispose: host.dispose }
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 })

  try {
    const config = await loadModelConfig()
    const concurrency = await loadTabConcurrency()
    void runResearch({
      id: `r${Date.now()}`,
      question,
      depth,
      host,
      concurrency,
      complete: (messages, kind, signal) =>
        complete({ messages }, config, signal === undefined ? { kind } : { kind, signal }),
      onEvent: broadcast,
      signal: kill.signal,
    })
      .then(async (result) => {
        await saveResearchResult(result)
      })
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        broadcast({ type: 'failed', error: text })
      })
      .finally(() => {
        active = null
        chrome.alarms.clear(KEEPALIVE_ALARM)
        void host.dispose()
      })
    return { ok: true }
  } catch (error) {
    active = null
    chrome.alarms.clear(KEEPALIVE_ALARM)
    void host.dispose()
    const text = error instanceof Error ? error.message : String(error)
    return { ok: false, error: text }
  }
}

export function stopResearch(): { ok: boolean; error?: string } {
  if (active === null) return { ok: false, error: 'No research run is in progress.' }
  active.kill.stop()
  void active.dispose()
  return { ok: true }
}

/** Follow-up chat over the stored corpus (spec §7), never re-reading the web. */
export async function researchFollowup(
  runId: string,
  question: string,
): Promise<{ ok: boolean; answer?: string; error?: string }> {
  const result = await loadResearchResult(runId)
  if (result === null) return { ok: false, error: 'That research run is no longer stored.' }
  if (result.sources.length === 0) return { ok: false, error: 'That run kept no sources, so there is nothing to ask about.' }

  try {
    const config = await loadModelConfig()
    const numberById = new Map(citationNumbers(result.sources).map((citation) => [citation.sourceId, citation.n]))
    const { context } = buildFollowupContext(result.sources, numberById, question)
    if (context === '') {
      return { ok: true, answer: 'None of the gathered sources cover that.' }
    }
    const completion = await complete({ messages: buildFollowupMessages(question, context) }, config, { kind: 'big' })
    return { ok: true, answer: (completion.message.content ?? 'The model returned nothing.').trim() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The MV3 service worker dies when idle; an active alarm resets the timer. */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM && active !== null) {
    void chrome.runtime.getPlatformInfo().catch(() => undefined)
  }
})
