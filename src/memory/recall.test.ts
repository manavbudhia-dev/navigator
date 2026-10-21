import { describe, expect, it } from 'vitest'

import { cleanTags, rankMemories, scoreMemory, tokenize, whenLabel, type MemoryEntry } from './recall'

const DAY = 86_400_000
const NOW = 1_700_000_000_000

function note(text: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return { id: 1, at: NOW, text, tags: [], url: '', ...overrides }
}

describe('tokenize', () => {
  it('keeps meaningful words and drops the filler', () => {
    expect(tokenize('What is my preferred city?')).toEqual(['preferred', 'city'])
    expect(tokenize('the and for')).toEqual([])
  })

  it('keeps numbers, dots and hyphens inside a word', () => {
    expect(tokenize('the rent is 1,450.50 for flat-2b')).toEqual(['rent', '450.50', 'flat-2b'])
  })

  it('de-duplicates', () => {
    expect(tokenize('cv cv cv')).toEqual(['cv'])
  })
})

describe('scoreMemory', () => {
  it('scores a tag hit above a text hit', () => {
    const byTag = scoreMemory('berlin', note('I like it here', { tags: ['berlin'] }), NOW)
    const byText = scoreMemory('berlin', note('The Berlin office replied'), NOW)
    expect(byTag).toBeGreaterThan(byText)
  })

  it('is zero when nothing the query asked for appears', () => {
    expect(scoreMemory('salary', note('The wifi password was rotated', { tags: ['wifi'] }), NOW)).toBe(0)
  })

  it('rewards covering more of the query', () => {
    const both = scoreMemory('heat pump quote', note('heat pump quotes arrive by email'), NOW)
    const one = scoreMemory('heat pump quote', note('pumpkins grow here'), NOW)
    expect(both).toBeGreaterThan(one)
  })

  it('counts a url match, and nothing for an unmatchable query', () => {
    expect(scoreMemory('gifthub', note('the login page', { url: 'https://gifthub.example/login' }), NOW)).toBeGreaterThan(0)
    expect(scoreMemory('the', note('anything'), NOW)).toBe(0)
  })

  it('prefers a newer note when the match is identical', () => {
    const old = scoreMemory('invoice', note('Invoices live in Drive', { at: NOW - 400 * DAY }), NOW)
    const fresh = scoreMemory('invoice', note('Invoices live in Drive', { at: NOW }), NOW)
    expect(fresh).toBeGreaterThan(old)
  })
})

describe('rankMemories', () => {
  const entries = [
    note('Prefers remote roles inside the EU', { id: 1, tags: ['preference'], at: NOW - 90 * DAY }),
    note('The job board needs login at jobs.example.com', { id: 2, tags: ['login'], url: 'https://jobs.example.com', at: NOW - DAY }),
    note('Salary expectation is 90k', { id: 3, tags: ['preference', 'salary'], at: NOW - 2 * DAY }),
  ]

  it('returns the notes that match, best first', () => {
    expect(rankMemories('preference salary', entries, 5, NOW).map((e) => e.id)).toEqual([3, 1])
  })

  it('caps the list', () => {
    expect(rankMemories('preference', entries, 1, NOW)).toHaveLength(1)
  })

  it('reads an empty query as "the most recent notes"', () => {
    expect(rankMemories('', entries, 2, NOW).map((e) => e.id)).toEqual([2, 3])
  })

  it('drops notes that match nothing rather than padding the answer', () => {
    expect(rankMemories('passport', entries, 5, NOW)).toEqual([])
  })
})

describe('cleanTags', () => {
  it('lower-cases, trims, shortens and caps at six', () => {
    const tags = cleanTags(['  Billing ', 'job-search', '', 'a'.repeat(40), 'one', 'two', 'three', 'four'])
    expect(tags).toEqual(['billing', 'job-search', 'a'.repeat(40).slice(0, 24), 'one', 'two', 'three'])
  })

  it('removes duplicates that differ only by case', () => {
    expect(cleanTags(['CV', 'cv', 'resume'])).toEqual(['cv', 'resume'])
  })
})

describe('whenLabel', () => {
  it('speaks in days, not timestamps', () => {
    expect(whenLabel(NOW, NOW)).toBe('today')
    expect(whenLabel(NOW - DAY, NOW)).toBe('yesterday')
    expect(whenLabel(NOW - 6 * DAY, NOW)).toBe('6 days ago')
    expect(whenLabel(NOW - 200 * DAY, NOW)).toBe(new Date(NOW - 200 * DAY).toISOString().slice(0, 10))
  })
})
