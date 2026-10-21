import { isProtectedScheme, tabOrder, urlKeyOf } from './model'
import type { TabInfo } from './types'

/**
 * Duplicate detection and merge (spec §8). Two tabs are duplicates when their
 * canonical URLs match: same article, ignoring fragments, `www.`, tracking
 * params and trailing slashes.
 */

export interface DuplicateGroup {
  key: string
  keep: TabInfo
  close: TabInfo[]
}

/** Higher is kept. Pinned tabs outrank everything: they are never collateral. */
function keepScore(tab: TabInfo): number {
  let score = 0
  if (tab.pinned) score += 32
  if (tab.active) score += 8
  if (!tab.discarded) score += 4
  if (tab.title.trim() !== '') score += 2
  if (tab.url.startsWith('https:')) score += 1
  return score
}

export function findDuplicates(tabs: readonly TabInfo[]): DuplicateGroup[] {
  const buckets = new Map<string, TabInfo[]>()
  for (const tab of tabs) {
    if (isProtectedScheme(tab.url)) continue
    const key = urlKeyOf(tab.url)
    if (key === '') continue
    const list = buckets.get(key)
    if (list) list.push(tab)
    else buckets.set(key, [tab])
  }

  const out: DuplicateGroup[] = []
  for (const [key, group] of buckets) {
    if (group.length < 2) continue
    const ranked = [...group].sort((a, b) => keepScore(b) - keepScore(a) || tabOrder(a, b))
    const keep = ranked[0]!
    const close = ranked.slice(1).filter((tab) => !tab.pinned)
    if (close.length === 0) continue
    out.push({ key, keep, close })
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

export function duplicateCount(tabs: readonly TabInfo[]): number {
  return findDuplicates(tabs).reduce((total, group) => total + group.close.length, 0)
}
