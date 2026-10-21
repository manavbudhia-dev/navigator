import { describe, expect, it } from 'vitest'

import { formatIdle, isStale, staleTabs } from './stale'
import { urlKeyOf } from './model'
import { tab } from './testUtils'
import type { TabStat } from './types'

const NOW = Date.UTC(2026, 9, 20, 12)
const DAY = 24 * 60 * 60 * 1000

function stat(url: string, daysAgo: number, overrides: Partial<TabStat> = {}): TabStat {
  return { urlKey: urlKeyOf(url), title: 'x', lastSeenAt: NOW - daysAgo * DAY, opens: 1, ...overrides }
}

const DRY = [
  tab(1, { index: 0, url: 'https://example.com/old', title: 'Old page' }),
  tab(2, { index: 1, url: 'https://example.com/fresh', title: 'Fresh page' }),
  tab(3, { index: 2, url: 'https://example.com/ancient', title: 'Ancient page' }),
]

function stats(): Map<string, TabStat> {
  return new Map(
    [stat('https://example.com/old', 9), stat('https://example.com/fresh', 1), stat('https://example.com/ancient', 40)].map(
      (entry) => [entry.urlKey, entry],
    ),
  )
}

describe('staleTabs', () => {
  it('reports only the tabs past the cutoff, worst first', () => {
    const stale = staleTabs(DRY, stats(), { days: 7, now: NOW })
    expect(stale.map((entry) => entry.tab.id)).toEqual([3, 1])
    expect(stale[0]!.daysIdle).toBe(40)
  })

  it('never proposes the active tab, a pinned tab or a Chrome page', () => {
    const stale = staleTabs(
      [
        tab(1, { index: 0, url: 'https://example.com/old', active: true }),
        tab(2, { index: 1, url: 'https://example.com/old2', pinned: true }),
        tab(3, { index: 2, url: 'chrome://settings' }),
      ],
      new Map([
        [urlKeyOf('https://example.com/old'), stat('https://example.com/old', 90)],
        [urlKeyOf('https://example.com/old2'), stat('https://example.com/old2', 90)],
        [urlKeyOf('chrome://settings'), stat('chrome://settings', 90)],
      ]),
      { days: 7, now: NOW },
    )
    expect(stale).toEqual([])
  })

  it('treats a URL it has never seen as not stale', () => {
    expect(staleTabs([tab(1, { url: 'https://never.seen/x' })], new Map(), { days: 7, now: NOW })).toEqual([])
  })

  it('honours a shorter window', () => {
    expect(staleTabs(DRY, stats(), { days: 30, now: NOW }).map((entry) => entry.tab.id)).toEqual([3])
  })
})

describe('isStale', () => {
  it('answers the same question for one stat', () => {
    expect(isStale(stat('https://example.com/old', 9), { days: 7, now: NOW })).toBe(true)
    expect(isStale(stat('https://example.com/fresh', 1), { days: 7, now: NOW })).toBe(false)
    expect(isStale(undefined, { days: 7, now: NOW })).toBe(false)
  })
})

describe('formatIdle', () => {
  it('reads like a person', () => {
    expect(formatIdle(0)).toBe('today')
    expect(formatIdle(1)).toBe('1 day ago')
    expect(formatIdle(9)).toBe('9 days ago')
    expect(formatIdle(31)).toBe('1 month ago')
    expect(formatIdle(95)).toBe('3 months ago')
  })
})
