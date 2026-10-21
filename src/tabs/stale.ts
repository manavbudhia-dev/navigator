import { isProtectedScheme, urlKeyOf } from './model'
import type { StaleTab, TabInfo, TabStat } from './types'

/**
 * Stale tab sweeper (spec §8): tabs untouched for more than X days are
 * *suggested* for archiving. Closing them automatically would be the one
 * thing the user did not ask for, so this module only reports.
 *
 * Chrome does not expose a tab's last-use time, so "untouched" is measured
 * against our own index of activations, keyed by canonical URL. A URL with no
 * entry has never been seen since the extension was installed, so it cannot
 * be called stale.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export function staleTabs(
  tabs: readonly TabInfo[],
  stats: Map<string, TabStat>,
  options: { days: number; now: number },
): StaleTab[] {
  const cutoff = options.now - options.days * DAY_MS
  const out: StaleTab[] = []
  for (const tab of tabs) {
    if (tab.active || tab.pinned || isProtectedScheme(tab.url)) continue
    const stat = stats.get(urlKeyOf(tab.url))
    if (stat === undefined || stat.lastSeenAt >= cutoff) continue
    out.push({ tab, lastSeenAt: stat.lastSeenAt, daysIdle: Math.floor((options.now - stat.lastSeenAt) / DAY_MS) })
  }
  return out.sort((a, b) => b.daysIdle - a.daysIdle)
}

export function isStale(stat: TabStat | undefined, options: { days: number; now: number }): boolean {
  if (stat === undefined) return false
  return stat.lastSeenAt < options.now - options.days * DAY_MS
}

export function formatIdle(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}
