import { describe, expect, it } from 'vitest'

import { urlKeyOf } from './model'
import { searchTabs, snippetFor } from './searchTabs'
import { indexMap, tab } from './testUtils'
import type { TabIndexEntry } from './types'

function indexed(url: string, text: string): TabIndexEntry {
  return { urlKey: urlKeyOf(url), url, title: 'x', text, chars: text.length, indexedAt: 0 }
}

const TABS = [
  tab(1, { index: 0, url: 'https://acme.example/plans', title: 'Plans and pricing' }),
  tab(2, { index: 1, url: 'https://blog.example/heat-pumps', title: 'How a heat pump works' }),
  tab(3, { index: 2, url: 'https://forum.example/thread/9', title: 'Thread 9' }),
]

const INDEX = indexMap([
  indexed('https://forum.example/thread/9', 'Everyone agrees the tariff decides the payback period. A heat pump costs more to install than a boiler.'),
  indexed('https://blog.example/heat-pumps', 'A heat pump moves warmth from outside air into the home, so the fan never burns fuel.'),
  indexed('https://acme.example/plans', 'Enterprise plan includes SSO and a support SLA.'),
])

describe('searchTabs', () => {
  it('matches a title and says where it found it', () => {
    const [best] = searchTabs(TABS, INDEX, 'pricing')
    expect(best!.tab.id).toBe(1)
    expect(best!.where).toBe('title')
  })

  it('matches a host or path the title never mentions', () => {
    const [best] = searchTabs(TABS, INDEX, 'acme')
    expect(best!.tab.id).toBe(1)
    expect(best!.where).toBe('url')
  })

  it('looks inside indexed page text', () => {
    const [best] = searchTabs(TABS, INDEX, 'payback period tariff')
    expect(best!.tab.id).toBe(3)
    expect(best!.where).toBe('content')
    expect(best!.snippet).toContain('payback')
  })

  it('reports both when title and text agree', () => {
    const [best] = searchTabs(TABS, INDEX, 'heat pump')
    expect(best!.where).toBe('both')
  })

  it('never claims a content match for a page it did not index', () => {
    const results = searchTabs(TABS, new Map(), 'payback tariff')
    expect(results).toHaveLength(0)
  })

  it('ranks a phrase hit above a scattered word hit', () => {
    const results = searchTabs(TABS, INDEX, 'heat pump')
    expect(results[0]!.score).toBeGreaterThan(0.5)
  })

  it('caps the result set', () => {
    expect(searchTabs(TABS, INDEX, 'heat pump plan', { limit: 1 })).toHaveLength(1)
  })

  it('restricts to the tabs a scoped command selected', () => {
    const results = searchTabs(TABS, INDEX, 'heat pump', { onlyIds: new Set([1]) })
    expect(results.every((result) => result.tab.id === 1)).toBe(true)
  })

  it('returns nothing for a query with no usable words', () => {
    expect(searchTabs(TABS, INDEX, 'the a an')).toEqual([])
    expect(searchTabs(TABS, INDEX, '')).toEqual([])
  })
})

describe('snippetFor', () => {
  it('returns the whole text when it already fits', () => {
    expect(snippetFor('The cat sat on the mat', ['cat'])).toBe('The cat sat on the mat')
  })

  it('centres the window on the matched term and marks the cut', () => {
    const text = `${'x '.repeat(200)}needle in a haystack ${'y '.repeat(60)}`
    const snippet = snippetFor(text, ['needle'], 40)
    expect(snippet).toContain('needle')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('falls back to the head when no term is present', () => {
    expect(snippetFor('nothing here at all', ['zzz'])).toBe('nothing here at all')
    expect(snippetFor('', ['zzz'])).toBe('')
  })
})
