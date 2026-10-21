import { describe, expect, it } from 'vitest'

import { duplicateCount, findDuplicates } from './dupes'
import { tab } from './testUtils'

describe('findDuplicates', () => {
  it('matches the same article across www, fragment and tracking params', () => {
    const groups = findDuplicates([
      tab(1, { index: 0, url: 'https://example.com/pricing' }),
      tab(2, { index: 1, url: 'https://www.example.com/pricing/#plans?utm_source=x' }),
      tab(3, { index: 2, url: 'https://example.com/other' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.close.map((entry) => entry.id)).toEqual([2])
  })

  it('keeps the copy the user is looking at', () => {
    const groups = findDuplicates([
      tab(1, { index: 0, url: 'https://example.com/a' }),
      tab(2, { index: 1, url: 'https://example.com/a', active: true, title: 'A page' }),
    ])
    expect(groups[0]!.keep.id).toBe(2)
  })

  it('keeps a live copy over a suspended one', () => {
    const groups = findDuplicates([
      tab(1, { index: 0, url: 'https://example.com/a', discarded: true, title: 'A' }),
      tab(2, { index: 1, url: 'https://example.com/a', title: 'A' }),
    ])
    expect(groups[0]!.keep.id).toBe(2)
  })

  it('never closes a pinned tab, even a duplicate one', () => {
    const groups = findDuplicates([
      tab(1, { index: 0, url: 'https://example.com/a', pinned: true, title: 'A' }),
      tab(2, { index: 1, url: 'https://example.com/a', pinned: true, title: 'A' }),
    ])
    expect(groups).toHaveLength(0)
  })

  it('ignores Chrome pages and unfinalisable URLs', () => {
    expect(
      findDuplicates([
        tab(1, { index: 0, url: 'chrome://newtab', title: 'New Tab' }),
        tab(2, { index: 1, url: 'chrome://newtab', title: 'New Tab' }),
        tab(3, { index: 2, url: 'about:blank' }),
        tab(4, { index: 3, url: 'about:blank' }),
      ]),
    ).toEqual([])
  })

  it('reports three closable tabs when one page is open three times', () => {
    const tabs = [
      tab(1, { index: 0, url: 'https://example.com/a' }),
      tab(2, { index: 1, url: 'https://example.com/a' }),
      tab(3, { index: 2, url: 'https://example.com/a' }),
      tab(4, { index: 3, url: 'https://example.com/a' }),
    ]
    expect(findDuplicates(tabs)[0]!.close).toHaveLength(3)
    expect(duplicateCount(tabs)).toBe(3)
  })

  it('counts nothing when every URL is unique', () => {
    expect(duplicateCount([tab(1, { url: 'https://a.example/1' }), tab(2, { url: 'https://b.example/2' })])).toBe(0)
  })
})
