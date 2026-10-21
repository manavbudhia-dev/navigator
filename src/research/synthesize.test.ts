import { describe, expect, it } from 'vitest'

import {
  bulletBrief,
  citationsOf,
  clusterClaims,
  composeAnswer,
  confirmContradictions,
  contradictionsOf,
  deterministicAnswer,
  findGaps,
  orderSources,
  usageOf,
  validateCitations,
} from './synthesize'
import type { ResearchComplete, SourceNote, SubQuestion } from './types'
import type { CompletionResult } from '@/llm/types'

function note(overrides: Partial<SourceNote> = {}): SourceNote {
  return {
    id: 'https://a.example/1',
    runId: 'r1',
    url: 'https://a.example/1',
    title: 'Source A',
    subQuestionId: 'sq1',
    author: 'Ada',
    publishDate: '2026-01-02',
    text: 'Body of source A.',
    snippetQuotes: [],
    claims: ['Heat pumps cut heating bills by 40 percent.'],
    relevance: 0.9,
    credibility: 0.7,
    summary: 'A says heat pumps save money.',
    ...overrides,
  }
}

function reply(text: string): CompletionResult {
  return {
    message: { role: 'assistant', content: text },
    usage: { promptTokens: 10, completionTokens: 5 },
    finishReason: 'stop',
  }
}

describe('orderSources and citations', () => {
  it('numbers the most relevant, then most credible source first', () => {
    const notes = [note({ id: 'low', title: 'Low', relevance: 0.5, credibility: 0.9 }), note({ id: 'high', title: 'High', relevance: 0.8, credibility: 0.2 })]
    expect(orderSources(notes).map((entry) => entry.id)).toEqual(['high', 'low'])
    expect(citationsOf(orderSources(notes))).toEqual([
      { n: 1, sourceId: 'high', url: 'https://a.example/1', title: 'High' },
      { n: 2, sourceId: 'low', url: 'https://a.example/1', title: 'Low' },
    ])
  })
})

describe('clusterClaims', () => {
  it('merges the same claim from two sources into one cluster', () => {
    const clusters = clusterClaims([
      note({ id: 's1', claims: ['Heat pumps cut heating bills by 40 percent.'] }),
      note({ id: 's2', claims: ['Heat pumps cut heating bills by nearly half.'] }),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.sources.map((entry) => entry.sourceId)).toEqual(['s1', 's2'])
    expect(clusters[0]?.agreement).toBe('agreement')
  })

  it('keeps unrelated claims apart', () => {
    const clusters = clusterClaims([
      note({ id: 's1', claims: ['Heat pumps cut heating bills by 40 percent.'] }),
      note({ id: 's2', claims: ['Installers are scarce in rural regions of the country.'] }),
    ])
    expect(clusters).toHaveLength(2)
    expect(clusters.every((cluster) => cluster.agreement === 'single')).toBe(true)
  })

  it('detects a contradiction from the negated side', () => {
    const clusters = clusterClaims([
      note({ id: 's1', claims: ['Heat pumps cut heating bills by 40 percent.'] }),
      note({ id: 's2', claims: ['Heat pumps do not cut heating bills in cold climates.'] }),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.agreement).toBe('contradiction')
    const conflicts = contradictionsOf(clusters)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.sides).toHaveLength(2)
  })

  it('never invents a cluster out of an empty claim list', () => {
    expect(clusterClaims([note({ claims: [] })])).toEqual([])
  })
})

describe('confirmContradictions', () => {
  const clusters = clusterClaims([
    note({ id: 's1', claims: ['Heat pumps cut heating bills by 40 percent.'] }),
    note({ id: 's2', claims: ['Heat pumps cut heating bills by nearly half.'] }),
  ])

  it('lets the model overturn the negation heuristic', async () => {
    const calls: string[] = []
    const complete: ResearchComplete = async (messages) => {
      calls.push(messages[1]?.content ?? '')
      return reply('{"clusters":[{"id":"c1","relation":"conflict"}]}')
    }
    const out = await confirmContradictions(clusters, complete)
    expect(out.clusters[0]?.agreement).toBe('contradiction')
    expect(calls[0]).toContain('Cluster c1')
    expect(usageOf([out])).toEqual({ promptTokens: 10, completionTokens: 5 })
  })

  it('does nothing without a model or with a single-source cluster', async () => {
    expect(await confirmContradictions(clusters, undefined)).toEqual({
      clusters,
      promptTokens: 0,
      completionTokens: 0,
    })
    const singles = clusterClaims([note({ id: 's1' })])
    expect((await confirmContradictions(singles, async () => reply('{}'))).clusters).toEqual(singles)
  })

  it('keeps the heuristic answer when the model replies with junk', async () => {
    const out = await confirmContradictions(clusters, async () => reply('not json'))
    expect(out.clusters[0]?.agreement).toBe('agreement')
  })
})

describe('validateCitations', () => {
  it('drops numbers we never issued and cleans the gap left behind', () => {
    const valid = new Set([1, 2])
    expect(validateCitations('Saves money [1][3], and [99] too.', valid)).toBe('Saves money [1], and too.')
    expect(validateCitations('Saves 7% [12].', valid)).toBe('Saves 7%.')
  })
})

describe('composeAnswer', () => {
  const citations = citationsOf(orderSources([note({ id: 's1' })]))

  it('returns model prose and strips invalid citations', async () => {
    const draft = await composeAnswer('q', clusterClaims([note({ id: 's1' })]), citations, [note({ id: 's1' })], async () => reply('They save 40% [1] and 7% [12].'))
    expect(draft.answer).toBe('They save 40% [1] and 7%.')
    expect(draft.promptTokens).toBe(10)
  })

  it('falls back to the deterministic report when the model fails', async () => {
    const failing: ResearchComplete = async () => {
      throw new Error('rate limited')
    }
    const draft = await composeAnswer('q', clusterClaims([note({ id: 's1' })]), citations, [note({ id: 's1' })], failing)
    expect(draft.answer).toContain('[1]')
    expect(draft.promptTokens).toBe(0)
  })

  it('says so when there is no evidence at all', async () => {
    expect(await composeAnswer('q', [], [], [], undefined)).toEqual({
      answer: 'No usable sources were found, so there is nothing to report.',
      promptTokens: 0,
      completionTokens: 0,
    })
  })
})

describe('deterministic answer', () => {
  it('shows both sides of a contested cluster', () => {
    const clusters = clusterClaims([
      note({ id: 's1', claims: ['Heat pumps cut heating bills by 40 percent.'] }),
      note({ id: 's2', claims: ['Heat pumps do not cut heating bills in cold climates.'] }),
    ])
    const idToNumber = new Map([
      ['s1', 1],
      ['s2', 2],
    ])
    const text = deterministicAnswer(clusters, idToNumber)
    expect(text).toContain('Contested')
    expect(text).toContain('[1]')
    expect(text).toContain('[2]')
  })
})

describe('gaps and brief', () => {
  const subs: SubQuestion[] = [
    { id: 'sq1', question: 'What do heat pumps cost?', queries: ['heat pump cost'] },
    { id: 'sq2', question: 'How noisy are heat pumps outdoors?', queries: ['heat pump noise'] },
  ]

  it('lists what the answer failed to cover', () => {
    expect(findGaps(subs, 'Heat pumps cost 8000 installed. [1]')).toEqual(['How noisy are heat pumps outdoors?'])
  })

  it('briefs one line per cluster', () => {
    const clusters = clusterClaims([note({ id: 's1' }), note({ id: 's2', claims: ['Installers are scarce in rural regions.'] })])
    expect(bulletBrief(clusters, 1)).toHaveLength(1)
  })
})
