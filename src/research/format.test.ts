import { describe, expect, it } from 'vitest'

import { downloadName, FORMATS, render, toBrief, toCsv, toJson, toMarkdown, toTable } from './format'
import type { ResearchResult, SourceNote } from './types'

const NOTE: SourceNote = {
  id: 'https://a.example/1',
  runId: 'r1',
  url: 'https://a.example/1',
  title: 'Meter study, two years in',
  subQuestionId: 'sq1',
  author: 'Nina Okoye',
  publishDate: '2026-02-11',
  text: 'Body',
  snippetQuotes: ['Heat pumps cut heating bills by 40 percent.'],
  claims: ['Heat pumps cut heating bills by 40 percent.', 'Payback took seven years.'],
  relevance: 0.9,
  credibility: 0.8,
  summary: 'Metered savings.',
}

const SECOND: SourceNote = {
  ...NOTE,
  id: 'https://b.example/2',
  url: 'https://b.example/2',
  title: 'Cold climate report',
  author: null,
  publishDate: null,
  credibility: 0.5,
  relevance: 0.7,
  claims: ['Heat pumps do not cut heating bills in cold climates.'],
  snippetQuotes: [],
  summary: 'Cold defeats the savings.',
}

function fixture(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    id: 'r1',
    question: 'Do heat pumps save money?',
    depth: 'standard',
    createdAt: Date.UTC(2026, 3, 5, 9, 30),
    answer: 'Metered homes saved 40 percent [1], but the cold-climate field report says otherwise [2].',
    brief: ['Heat pumps cut heating bills by 40 percent.', 'Heat pumps do not cut heating bills in cold climates.'],
    citations: [
      { n: 1, sourceId: NOTE.id, url: NOTE.url, title: NOTE.title },
      { n: 2, sourceId: SECOND.id, url: SECOND.url, title: SECOND.title },
    ],
    clusters: [
      {
        id: 'c1',
        text: 'Heat pumps cut heating bills by 40 percent.',
        sources: [
          { sourceId: NOTE.id, claim: 'Heat pumps cut heating bills by 40 percent.' },
          { sourceId: SECOND.id, claim: 'Heat pumps do not cut heating bills in cold climates.' },
        ],
        agreement: 'contradiction',
      },
    ],
    contradictions: [
      {
        clusterId: 'c1',
        topic: 'Heat pumps cut heating bills by 40 percent.',
        sides: [
          { sourceId: NOTE.id, claim: 'Heat pumps cut heating bills by 40 percent.' },
          { sourceId: SECOND.id, claim: 'Heat pumps do not cut heating bills in cold climates.' },
        ],
      },
    ],
    sources: [NOTE, SECOND],
    discarded: [{ url: 'https://x.example/off', title: 'Sourdough', relevance: 0.1, reason: 'off-topic' }],
    gaps: ['How loud are heat pumps outdoors?'],
    rounds: 1,
    promptTokens: 1200,
    completionTokens: 340,
    ...overrides,
  }
}

describe('toMarkdown', () => {
  const text = toMarkdown(fixture())

  it('leads with the question and a run summary', () => {
    expect(text).toContain('# Do heat pumps save money?')
    expect(text).toContain('_standard research · 2 sources · 1 gather round_')
    expect(text).toContain('Metered homes saved 40 percent [1]')
  })

  it('names the disagreement instead of hiding it', () => {
    expect(text).toContain('## Where the sources disagree')
    expect(text).toContain('- Heat pumps do not cut heating bills in cold climates. [2]')
  })

  it('lists numbered sources with their credibility', () => {
    expect(text).toContain('1. [Meter study, two years in](https://a.example/1) — by Nina Okoye · 2026-02-11 · credibility 0.80')
    expect(text).toContain('2. [Cold climate report](https://b.example/2)')
    expect(text).toContain('1 page was opened and dropped as off-topic')
    expect(text).toContain('## Still open')
  })

  it('uses one gather round wording for plural rounds', () => {
    expect(toMarkdown(fixture({ rounds: 2 }))).toContain('2 gather rounds')
  })
})

describe('toTable', () => {
  it('renders one comparison row per source', () => {
    const table = toTable(fixture())
    expect(table.split('\n')[0]).toBe('| # | Source | Credibility | Relevance | Date | Author | Main claim |')
    expect(table).toContain('| 1 | Meter study, two years in | 0.80 | 0.90 | 2026-02-11 | Nina Okoye |')
    expect(table).toContain('| 2 | Cold climate report | 0.50 | 0.70 | — | — |')
  })

  it('escapes pipes and says so when empty', () => {
    expect(toTable(fixture({ sources: [{ ...NOTE, title: 'a | b' }] }))).toContain('a \\| b')
    expect(toTable(fixture({ sources: [] }))).toContain('No sources were kept')
  })
})

describe('toCsv', () => {
  it('quotes cells that contain commas and repeats the url per claim', () => {
    const rows = toCsv(fixture()).split('\n')
    expect(rows[0]).toBe('url,title,author,publish_date,relevance,credibility,claim')
    expect(rows[1]).toBe('https://a.example/1,"Meter study, two years in",Nina Okoye,2026-02-11,0.9,0.8,Heat pumps cut heating bills by 40 percent.')
    expect(rows).toHaveLength(4)
  })

  it('escapes embedded quotes', () => {
    expect(toCsv(fixture({ sources: [{ ...NOTE, claims: ['They said "40%" loudly'] }] }))).toContain('"They said ""40%"" loudly"')
  })
})

describe('toJson', () => {
  it('defaults to the full note object', () => {
    const parsed = JSON.parse(toJson(fixture())) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual([
      'question',
      'depth',
      'date',
      'answer',
      'brief',
      'sources',
      'contradictions',
      'gaps',
      'citations',
      'tokens',
    ])
    const first = (parsed.sources as Record<string, unknown>[])[0]
    expect(first).toHaveProperty('snippet_quotes')
    expect(first).toHaveProperty('publish_date')
  })

  it('renames and selects fields through a user schema', () => {
    const parsed = JSON.parse(toJson(fixture(), '{"summary":"answer","refs":"citations","junk":"nope"}')) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['summary', 'refs'])
    expect(parsed.refs).toHaveLength(2)
  })

  it('ignores a schema that is not an object', () => {
    expect(JSON.parse(toJson(fixture(), '[1,2]'))).toHaveProperty('question')
    expect(JSON.parse(toJson(fixture(), 'not json')).question).toBe('Do heat pumps save money?')
  })
})

describe('toBrief', () => {
  it('lists findings, disagreements and open questions', () => {
    const brief = toBrief(fixture())
    expect(brief).toContain('- Heat pumps cut heating bills by 40 percent.')
    expect(brief).toContain('Contested:')
    expect(brief).toContain('- Heat pumps cut heating bills by 40 percent. (2 sources disagree)')
    expect(brief).toContain('Still open:')
  })
})

describe('render and download names', () => {
  it('dispatches every declared format', () => {
    for (const format of FORMATS) {
      expect(render(fixture(), format.id).length).toBeGreaterThan(0)
    }
    expect(render(fixture(), 'json', '{"a":"gaps"}')).toBe('{\n  "a": [\n    "How loud are heat pumps outdoors?"\n  ]\n}')
  })

  it('makes a safe filename', () => {
    expect(downloadName('Do heat pumps save money??', 'csv')).toBe('do-heat-pumps-save-money.csv')
    expect(downloadName('???', 'markdown')).toBe('research.md')
  })
})
