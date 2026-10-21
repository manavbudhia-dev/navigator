import { describe, expect, it } from 'vitest'

import { heavyCandidates } from './memory'
import { BASE_TAB_BYTES, urlKeyOf } from './model'
import { tab } from './testUtils'
import type { TabIndexEntry } from './types'

function indexed(url: string, chars: number): TabIndexEntry {
  return { urlKey: urlKeyOf(url), url, title: 'x', text: 'y'.repeat(chars), chars, indexedAt: 0 }
}

describe('heavyCandidates', () => {
  const tabs = [
    tab(1, { index: 0, url: 'https://example.com/small' }),
    tab(2, { index: 1, url: 'https://example.com/big' }),
    tab(3, { index: 2, url: 'https://example.com/active', active: true }),
    tab(4, { index: 3, url: 'https://example.com/pinned', pinned: true }),
    tab(5, { index: 4, url: 'https://example.com/gone', discarded: true }),
    tab(6, { index: 5, url: 'chrome://newtab' }),
  ]

  const index = new Map(
    [indexed('https://example.com/big', 100_000), indexed('https://example.com/small', 100), indexed('https://example.com/active', 50_000)].map(
      (entry) => [entry.urlKey, entry],
    ),
  )

  it('offers only suspendable tabs, heaviest first', () => {
    const candidates = heavyCandidates(tabs, index, 10)
    expect(candidates.map((candidate) => candidate.tab.id)).toEqual([2, 1])
  })

  it('measures weight from the indexed text, not from a guess', () => {
    const [heavy, light] = heavyCandidates(tabs, index, 10)
    expect(heavy!.measured).toBe(true)
    expect(heavy!.bytes).toBe(BASE_TAB_BYTES + 100_000 * 18)
    expect(light!.bytes).toBe(BASE_TAB_BYTES + 100 * 18)
    expect(heavy!.bytes).toBeGreaterThan(light!.bytes)
  })

  it('estimates for a page it has never read', () => {
    const [only] = heavyCandidates([tab(7, { url: 'https://example.com/unread' })], new Map(), 5)
    expect(only!.measured).toBe(false)
    expect(only!.bytes).toBe(BASE_TAB_BYTES)
  })

  it('limits the pass so a huge window cannot freeze the panel', () => {
    const many = Array.from({ length: 12 }, (_, i) => tab(i + 1, { index: i, url: `https://example.com/${i}` }))
    expect(heavyCandidates(many, new Map(), 4)).toHaveLength(4)
    expect(heavyCandidates(many, new Map(), 0)).toHaveLength(0)
  })

  it('breaks a weight tie by tab id so the order is stable', () => {
    const ids = heavyCandidates(
      [tab(9, { index: 0, url: 'https://example.com/a' }), tab(8, { index: 1, url: 'https://example.com/b' })],
      new Map(),
      5,
    ).map((candidate) => candidate.tab.id)
    expect(ids).toEqual([8, 9])
  })
})
