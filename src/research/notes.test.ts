import { describe, expect, it } from 'vitest'

import { buildNote, credibilityOf, keywordGate, pickClaims, pickQuotes, NOTE_TEXT_BUDGET, PREFILTER_FLOOR } from './notes'
import type { PageArticle, SubQuestion } from './types'

const SUB: SubQuestion = {
  id: 'sq1',
  question: 'How long do solid-state batteries last?',
  queries: ['solid-state battery lifespan'],
}

function article(overrides: Partial<PageArticle> = {}): PageArticle {
  return {
    url: 'https://news.example.com/solid-state-battery-life',
    title: 'Solid-state battery life, explained',
    text:
      'Solid-state batteries last about 1000 cycles in our tests. The study found that temperature control matters more than chemistry. ' +
      'Experts say a pack can reach 15 years. Most current cells degrade after 500 cycles. The research was led by a university team.',
    author: 'Dana Wells',
    publishDate: '2026-03-04',
    ...overrides,
  }
}

describe('keywordGate', () => {
  it('scores an on-topic page well above the pre-filter floor', () => {
    expect(keywordGate(SUB, article())).toBeGreaterThan(PREFILTER_FLOOR)
  })

  it('fails a page about something else without spending model tokens', () => {
    const off = article({
      url: 'https://blog.example.com/sourdough',
      title: 'Sourdough starter guide',
      text: 'Flour and water ferment for twelve hours. Feed your starter daily and keep it warm.',
    })
    expect(keywordGate(SUB, off)).toBeLessThan(PREFILTER_FLOOR)
  })
})

describe('quote and claim picking', () => {
  it('prefers sentences that answer the sub-question', () => {
    const quotes = pickQuotes(article().text, ['solid', 'state', 'battery', 'last'])
    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes[0]).toContain('Solid-state batteries last about 1000 cycles')
  })

  it('keeps factual sentences as claims', () => {
    const claims = pickClaims(article().text, ['battery', 'cycles', 'degrade'])
    expect(claims.some((claim) => /\d/.test(claim))).toBe(true)
    expect(claims.length).toBeLessThanOrEqual(4)
  })

  it('returns nothing for a page with no usable sentences', () => {
    expect(pickQuotes('Menu Search Sign in', ['battery'])).toEqual([])
  })
})

describe('credibilityOf', () => {
  it('rewards a signed, dated article on a known host', () => {
    const score = credibilityOf(article(), null)
    expect(score).toBeGreaterThanOrEqual(0.5)
    expect(score).toBeLessThan(0.8)
  })

  it('penalises an anonymous page with almost no content', () => {
    const thin = article({
      url: 'https://random-blog.xyz/post',
      author: null,
      publishDate: null,
      text: 'Short take.',
    })
    expect(credibilityOf(thin, null)).toBeLessThan(0.4)
  })

  it('blends a model opinion instead of trusting either side', () => {
    const base = credibilityOf(article(), null)
    expect(credibilityOf(article(), 0)).toBeLessThan(base)
    expect(credibilityOf(article(), 1)).toBeGreaterThan(base)
  })
})

describe('buildNote', () => {
  it('uses model scores when present and falls back to heuristics', () => {
    const note = buildNote({
      runId: 'r1',
      subQuestion: SUB,
      article: article(),
      scores: {
        relevance: 0.9,
        credibility: 0.7,
        quotes: ['A verbatim quote from the page.'],
        claims: ['Solid-state packs reach 15 years.'],
      },
      relevance: 0.9,
    })
    expect(note.id).toBe(note.url)
    expect(note.snippetQuotes).toEqual(['A verbatim quote from the page.'])
    expect(note.claims).toEqual(['Solid-state packs reach 15 years.'])
    expect(note.subQuestionId).toBe('sq1')
    expect(note.credibility).toBeGreaterThan(0.5)

    const heuristic = buildNote({ runId: 'r1', subQuestion: SUB, article: article(), scores: null, relevance: 0.8 })
    expect(heuristic.snippetQuotes.length).toBeGreaterThan(0)
    expect(heuristic.summary).toBe('')
  })

  it('trims long page text to the retrieval budget', () => {
    const long = article({ text: 'Battery life degrades slowly. '.repeat(2000) })
    const note = buildNote({ runId: 'r1', subQuestion: SUB, article: long, scores: null, relevance: 0.8 })
    expect(note.text.length).toBeLessThanOrEqual(NOTE_TEXT_BUDGET + 1)
  })
})
