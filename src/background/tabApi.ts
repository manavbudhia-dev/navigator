import { complete } from '@/llm'
import { loadModelConfig } from '@/llm/config'
import type { RunOptions } from '@/tabs/manager'
import { TabManager } from '@/tabs/manager'
import { isProtectedScheme, urlKeyOf } from '@/tabs/model'
import { tabMemory, touchTabs } from '@/tabs/store'
import { UndoBuffer } from '@/tabs/undo'
import type { TabOps } from '@/tools/types'
import type { TabComplete, TabInfo, TabIntent, TabReport, TabSurface } from '@/tabs/types'

import { createChromeTabSurface, toTabInfo } from './tabSurface'

/**
 * The tab manager, owned by the service worker (spec §8). The panel and the
 * agent's tools both go through here so the 60-second undo buffer has exactly
 * one owner: two buffers would mean an UNDO that reopens half the page set.
 */

const KEEPALIVE_ALARM = 'navigator-tabs-keepalive'
const TOUCH_FLUSH_MS = 5_000

/** One buffer for the whole worker, shared by every run. */
const undo = new UndoBuffer()

let runs = 0

async function buildManager(surface?: TabSurface): Promise<TabManager> {
  let completeFn: TabComplete | undefined
  try {
    const config = await loadModelConfig()
    completeFn = (messages, kind, signal) =>
      complete({ messages }, config, signal === undefined ? { kind } : { kind, signal })
  } catch {
    // No usable model config: the manager still does everything heuristically.
    completeFn = undefined
  }
  return new TabManager({
    surface: surface ?? createChromeTabSurface(),
    memory: tabMemory,
    undo,
    ...(completeFn === undefined ? {} : { complete: completeFn }),
  })
}

async function withKeepalive<T>(task: () => Promise<T>): Promise<T> {
  runs += 1
  if (runs === 1) chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 })
  try {
    return await task()
  } finally {
    runs -= 1
    if (runs <= 0) {
      runs = 0
      chrome.alarms.clear(KEEPALIVE_ALARM)
    }
  }
}

export async function runTabIntent(intent: TabIntent, options: RunOptions = {}): Promise<TabReport> {
  return withKeepalive(async () => (await buildManager()).run(intent, options))
}

export async function runTabCommand(text: string, options: RunOptions = {}): Promise<TabReport> {
  return withKeepalive(async () => (await buildManager()).runCommand(text, options))
}

/** The agent's tab tools bind to one manager for the whole task. */
export async function createTabOps(): Promise<TabOps> {
  const manager = await buildManager()
  return {
    run: (intent, options) =>
      withKeepalive(async () => {
        const guard = options?.guard ?? { keepIds: [] }
        return manager.run(intent, { guard, ...(options?.signal === undefined ? {} : { signal: options.signal }) })
      }),
  }
}

export function tabUndoState() {
  return undo.state()
}

// --------------------------------------------------------- last-seen bookkeeping

const pending = new Map<string, TabInfo>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function note(tab: chrome.tabs.Tab): void {
  const info = toTabInfo(tab)
  if (info.id < 0 || isProtectedScheme(info.url)) return
  pending.set(`${urlKeyOf(info.url)}|${info.windowId}`, info)
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const batch = [...pending.values()]
    pending.clear()
    void touchTabs(batch).catch(() => undefined)
  }, TOUCH_FLUSH_MS)
}

/**
 * The only clock we have for staleness: activations and completed loads. The
 * debounce matters — a single page load fires onUpdated a dozen times.
 */
export function startTabWatchers(): void {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    void chrome.tabs
      .get(activeInfo.tabId)
      .then((tab) => note(tab))
      .catch(() => undefined)
  })

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url !== undefined || tab.active) note(tab)
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [key, info] of pending) {
      if (info.id === tabId) pending.delete(key)
    }
  })
}

/** The MV3 worker dies when idle; this alarm buys the index pass more time. */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM && runs > 0) {
    void chrome.runtime.getPlatformInfo().catch(() => undefined)
  }
})
