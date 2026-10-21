import { estimateTabBytes, isProtectedScheme, urlKeyOf } from './model'
import type { TabIndexEntry, TabInfo } from './types'

/**
 * Memory saver (spec §8): suspend the heaviest inactive tabs with
 * `discard()`. A discarded tab keeps its URL and favicon and reloads on click,
 * so this is the safe half of closing — which is why it is a separate verb.
 */

export interface SuspendCandidate {
  tab: TabInfo
  bytes: number
  /** True when the page's text had been indexed, so the weight is measured. */
  measured: boolean
}

export function heavyCandidates(
  tabs: readonly TabInfo[],
  index: Map<string, TabIndexEntry>,
  limit: number,
): SuspendCandidate[] {
  const candidates: SuspendCandidate[] = []
  for (const tab of tabs) {
    if (tab.active || tab.pinned || tab.discarded || isProtectedScheme(tab.url)) continue
    const entry = index.get(urlKeyOf(tab.url))
    candidates.push({ tab, bytes: estimateTabBytes(entry ?? null), measured: entry !== undefined })
  }
  candidates.sort((a, b) => b.bytes - a.bytes || a.tab.id - b.tab.id)
  return candidates.slice(0, Math.max(0, limit))
}
