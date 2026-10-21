import { describe, expect, it } from 'vitest'

import { clip, contentTokens, coverage, polarity, sentences, similarity, unique } from './text'

describe('research text helpers', () => {
  it('drops stop words and stems plurals', () => {
    expect(contentTokens('The studies report higher rates')).toEqual(
      expect.arrayContaining(['study', 'report', 'higher', 'rate']),
    )
    expect(contentTokens('what is the price')).toEqual(['price'])
  })

  it('measures term coverage without counting repeats', () => {
    const terms = contentTokens('battery life improves')
    expect(coverage(terms, 'battery battery life')).toBeCloseTo(2 / 3)
    expect(coverage([], 'anything')).toBe(0)
  })

  it('scores similarity between claims', () => {
    expect(similarity('prices rose in 2025', 'prices rose in 2025')).toBe(1)
    expect(similarity('prices rose', 'the model trains')).toBe(0)
  })

  it('splits sentences on punctuation and skips chrome', () => {
    expect(sentences('First one. Second one?\n\n  - Third!')).toEqual(['First one.', 'Second one?', 'Third!'])
    expect(sentences('ok')).toEqual([])
  })

  it('flags negated claims', () => {
    expect(polarity('The trial failed to show a benefit')).toBe(-1)
    expect(polarity('The trial showed a clear benefit')).toBe(0)
    expect(polarity('no improvement was not observed')).toBe(1)
  })

  it('clips on a word boundary and dedupes', () => {
    expect(clip('one two three four', 13)).toBe('one two three…')
    expect(clip('short', 100)).toBe('short')
    expect(unique(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })
})
