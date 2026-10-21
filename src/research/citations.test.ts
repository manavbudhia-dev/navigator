import { describe, expect, it } from 'vitest'

import { explicitNumbers, layoutAnswer, sourcesForSentence, stripCitations } from './citations'
import type { SourceNote } from './types'

const NOTES: SourceNote[] = [
  {
    id: 'n1',
    runId: 'r1',
    url: 'https://a.example/1',
    title: 'Meter study',
    subQuestionId: 'sq1',
    author: null,
    publishDate: null,
    text: '',
    snippetQuotes: [],
    claims: ['Heat pumps cut heating bills by 40 percent in metered homes.'],
    relevance: 0.9,
    credibility: 0.8,
    summary: 'Metered savings of 40 percent.',
  },
  {
    id: 'n2',
    runId: 'r1',
    url: 'https://b.example/2',
    title: 'Cold climate field report',
    subQuestionId: 'sq1',
    author: null,
    publishDate: null,
    text: '',
    snippetQuotes: [],
    claims: ['Backup strips run constantly below minus seven degrees.'],
    relevance: 0.7,
    credibility: 0.6,
    summary: 'Cold weather defeats the savings.',
  },
]

describe('citation markers', () => {
  it('finds and removes the bracketed numbers', () => {
    expect(explicitNumbers('Saves [1] and [2] and [1].')).toEqual([1, 2])
    expect(stripCitations('Saves [1] money.')).toBe('Saves money.')
    expect(explicitNumbers('no markers')).toEqual([])
  })
})

describe('sourcesForSentence', () => {
  it('matches a sentence back to the source that supports it', () => {
    const numberById = new Map([
      ['n1', 1],
      ['n2', 2],
    ])
    expect(sourcesForSentence('The metered study found heating bills fell by 40 percent.', NOTES, numberById)).toEqual([1])
    expect(sourcesForSentence('Installers recommend a licence check.', NOTES, numberById)).toEqual([])
  })

  it('needs at least three terms before guessing', () => {
    expect(sourcesForSentence('heat pump', NOTES, new Map())).toEqual([])
  })
})

describe('layoutAnswer', () => {
  const answer = [
    '# Summary',
    '',
    'Heat pumps cut heating bills sharply [1]. They stop working well below minus seven degrees [2].',
    '',
    '- Savings depend on the meter [1]',
    'A sentence with a bogus marker [9].',
  ].join('\n')

  it('turns the report into hoverable lines with sources', () => {
    const lines = layoutAnswer(answer, NOTES)
    expect(lines[0]).toEqual({ kind: 'heading', parts: [{ text: 'Summary', sources: [], explicit: false }] })

    const first = lines[1]?.parts[0]
    expect(first?.text).toBe('Heat pumps cut heating bills sharply.')
    expect(first?.sources).toEqual([1])
    expect(first?.explicit).toBe(true)
    expect(lines[1]?.parts).toHaveLength(2)

    expect(lines[2]?.kind).toBe('bullet')
    expect(lines[3]?.kind).toBe('text')
  })

  it('falls back to content matching when the model drops its markers', () => {
    const lines = layoutAnswer('Backup strips run constantly in cold weather.', NOTES)
    expect(lines[0]?.parts[0]?.sources).toEqual([2])
    expect(lines[0]?.parts[0]?.explicit).toBe(false)
  })

  it('skips blank lines and heading-only answers', () => {
    expect(layoutAnswer('\n\n  \n', [])).toEqual([])
  })
})
