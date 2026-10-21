import { describe, expect, it } from 'vitest'

import {
  BASE_TAB_BYTES,
  canonicalUrl,
  estimateTabBytes,
  formatBytes,
  hostLabel,
  hostOf,
  isProtectedScheme,
  pathSegments,
  siteOf,
  sumBytes,
  tabLabel,
  tabOrder,
  urlKeyOf,
} from './model'
import type { TabIndexEntry } from './types'
import { tab } from './testUtils'

function entry(overrides: Partial<TabIndexEntry> = {}): TabIndexEntry {
  return {
    urlKey: 'https://example.com/a',
    url: 'https://example.com/a',
    title: 'A',
    text: 'x'.repeat(1000),
    chars: 1000,
    indexedAt: 0,
    ...overrides,
  }
}

describe('canonicalUrl', () => {
  it('ignores fragments, tracking params, www and trailing slashes', () => {
    expect(canonicalUrl('https://www.example.com/pricing/?utm_source=news#tiers')).toBe(
      canonicalUrl('https://example.com/pricing'),
    )
  })

  it('collapses index.html onto the directory', () => {
    expect(canonicalUrl('https://example.com/docs/index.html')).toBe('https://example.com/docs/')
  })

  it('returns an empty string for URLs that are not http(s)', () => {
    expect(canonicalUrl('chrome://newtab')).toBe('')
  })

  it('urlKeyOf falls back to the raw URL when it cannot be canonicalised', () => {
    expect(urlKeyOf('chrome://settings')).toBe('chrome://settings')
    expect(urlKeyOf('https://example.com/a?a=1&')).toBe(urlKeyOf('https://www.example.com/a?a=1&'))
  })
})

describe('host helpers', () => {
  it('strips the noise from a host', () => {
    expect(hostOf('https://www.YouTube.com/watch')).toBe('youtube.com')
    expect(hostOf('not a url')).toBe('')
  })

  it('reads path segments and stops after four', () => {
    expect(pathSegments('https://example.com/a/b/c/d/e')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('folds subdomains onto one site and keeps a second-level suffix whole', () => {
    expect(siteOf('https://music.youtube.com/listen')).toBe('youtube.com')
    expect(siteOf('https://www.example.com/a')).toBe('example.com')
    expect(siteOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
    expect(siteOf('chrome://newtab')).toBe('')
  })

  it('prefers a known brand and otherwise uses the registered name', () => {
    expect(hostLabel('https://music.youtube.com/watch')).toBe('YouTube')
    expect(hostLabel('https://arxiv.org/abs/1234')).toBe('Arxiv')
    expect(hostLabel('https://www.bbc.co.uk/news')).toBe('Bbc')
    expect(hostLabel('')).toBe('New tab')
  })

  it('protects Chrome pages from every bulk operation', () => {
    for (const url of ['chrome://newtab', 'about:blank', 'devtools://devtools/x', 'view-source:https://a.b', '']) {
      expect(isProtectedScheme(url)).toBe(true)
    }
    expect(isProtectedScheme('https://example.com')).toBe(false)
  })
})

describe('tabLabel', () => {
  it('collapses whitespace and prefers the title', () => {
    expect(tabLabel(tab(1, { title: 'Pricing\n   tiers  and costs' }))).toBe('Pricing tiers and costs')
  })

  it('shows the URL when the title is missing or is the URL itself', () => {
    expect(tabLabel(tab(2, { title: '', url: 'https://example.com/x' }))).toBe('https://example.com/x')
    expect(tabLabel(tab(3, { title: 'https://example.com/x', url: 'https://example.com/x' }))).toBe(
      'https://example.com/x',
    )
    expect(tabLabel(tab(4, { title: '', url: '' }))).toBe('Untitled')
  })

  it('clips a very long title', () => {
    const label = tabLabel(tab(5, { title: 'x'.repeat(150) }))
    expect(label).toHaveLength(90)
    expect(label.endsWith('…')).toBe(true)
  })
})

describe('memory estimate', () => {
  it('charges a renderer base plus the indexed text', () => {
    expect(estimateTabBytes(null)).toBe(BASE_TAB_BYTES)
    expect(estimateTabBytes(entry({ chars: 1000 })) - BASE_TAB_BYTES).toBe(1000 * 18)
  })

  it('formats megabytes honestly', () => {
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(BASE_TAB_BYTES)).toBe('46 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(sumBytes([BASE_TAB_BYTES, BASE_TAB_BYTES]))).toBe('92 MB')
  })
})

describe('tabOrder', () => {
  it('sorts by window then position', () => {
    const sorted = [
      tab(3, { windowId: 2, index: 0 }),
      tab(1, { windowId: 1, index: 5 }),
      tab(2, { windowId: 1, index: 1 }),
    ].sort(tabOrder)
    expect(sorted.map((entry) => entry.id)).toEqual([2, 1, 3])
  })
})
