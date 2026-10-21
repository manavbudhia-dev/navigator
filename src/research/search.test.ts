import { describe, expect, it } from 'vitest'

import { cleanUrl, hostReputation, isNoiseUrl, isSelfUrl, rankHits } from './search'

describe('cleanUrl', () => {
  it('strips fragments, tracking params and trailing slashes', () => {
    expect(cleanUrl('https://ex.com/article/?utm_source=news&fbclid=1&ref=top#/comments')).toBe(
      'https://ex.com/article',
    )
    expect(cleanUrl('https://ex.com/a/')).toBe('https://ex.com/a')
  })

  it('keeps real query params and refuses non-http schemes', () => {
    expect(cleanUrl('https://ex.com/search?q=battery%20life')).toBe('https://ex.com/search?q=battery+life')
    expect(cleanUrl('javascript:alert(1)')).toBe('')
    expect(cleanUrl('not a url')).toBe('')
  })
})

describe('isNoiseUrl', () => {
  it('rejects login walls, social chrome and assets', () => {
    expect(isNoiseUrl('https://ex.com/login?next=/article')).toBe(true)
    expect(isNoiseUrl('https://facebook.com/someone')).toBe(true)
    expect(isNoiseUrl('https://ex.com/logo.png')).toBe(true)
    expect(isNoiseUrl('https://ex.com/report')).toBe(false)
    expect(isNoiseUrl('https://ex.com/paper.pdf')).toBe(false)
  })
})

describe('isSelfUrl', () => {
  it('catches the results page itself and its subdomains', () => {
    expect(isSelfUrl('https://duckduckgo.com/?q=x', 'https://duckduckgo.com/html/?q=x')).toBe(true)
    expect(isSelfUrl('https://html.duckduckgo.com/x', 'https://duckduckgo.com')).toBe(true)
    expect(isSelfUrl('https://ex.com/a', 'https://duckduckgo.com')).toBe(false)
  })
})

describe('rankHits', () => {
  const raw = [
    { url: 'https://blog.example/one', title: 'Battery life improves in 2026', snippet: 'New cells store more energy.' },
    { url: 'https://blog.example/two', title: 'Another battery life report', snippet: 'Cycle counts rose.' },
    { url: 'https://noise.example/login', title: 'Battery', snippet: 'Sign in' },
    { url: 'https://other.example/battery-life', title: 'Nothing relevant here', snippet: 'Recipes for bread.' },
    { url: 'https://blog.example/one', title: 'Battery life improves in 2026', snippet: 'duplicate' },
  ]

  it('scores by query coverage, dedupes and caps per domain', () => {
    const hits = rankHits(raw, 'battery life', 4, { baseUrl: 'https://search.example/?q=battery' })
    expect(hits.map((hit) => hit.url)).toEqual([
      'https://blog.example/one',
      'https://blog.example/two',
      'https://other.example/battery-life',
    ])
    expect(hits[0]?.title).toBe('Battery life improves in 2026')
  })

  it('drops the results host and returns nothing for an empty list', () => {
    expect(rankHits([{ url: 'https://search.example/result', title: 'Battery life' }], 'battery', 5, { baseUrl: 'https://search.example' })).toEqual([])
    expect(rankHits([], 'battery', 5)).toEqual([])
  })
})

describe('hostReputation', () => {
  it('prefers gov/edu and known references over a random host', () => {
    expect(hostReputation('https://www.nih.gov/study')).toBeGreaterThan(0.7)
    expect(hostReputation('https://en.wikipedia.org/wiki/Battery')).toBe(0.8)
    expect(hostReputation('https://blogspot.example/post')).toBeLessThan(0.6)
  })
})
