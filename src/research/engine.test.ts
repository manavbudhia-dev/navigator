import { describe, expect, it } from 'vitest'

import { runResearch } from './engine'
import { MAX_CONCURRENCY } from './types'
import type { PageArticle, ResearchComplete, ResearchEvent, ResearchHost, SearchHit } from './types'
import type { CompletionResult } from '@/llm/types'

const PRO = 'https://review.example/heat-pumps-save-money'
const CON = 'https://journal.example/heat-pumps-cold'
const BREAD = 'https://blog.example/sourdough'

const PAGES: Record<string, PageArticle> = {
  [PRO]: {
    url: PRO,
    title: 'Do heat pumps save money? A two-year meter study',
    text: 'Heat pumps cut heating bills by 40 percent in our metering study. The payback period was seven years. Homes with old radiators saved less than new builds.',
    author: 'Nina Okoye',
    publishDate: '2026-02-11',
  },
  [CON]: {
    url: CON,
    title: 'Heat pumps in cold climates',
    text: 'Heat pumps do not cut heating bills by 40 percent once the temperature falls below minus 7. Backup electric strips then run constantly.',
    author: null,
    publishDate: null,
  },
  [BREAD]: {
    url: BREAD,
    title: 'Sourdough starter guide',
    text: 'Flour and water ferment for twelve hours. Feed the starter daily and keep it somewhere warm.',
    author: 'Blog',
    publishDate: '2026-01-01',
  },
}

function reply(text: string): CompletionResult {
  return { message: { role: 'assistant', content: text }, usage: { promptTokens: 3, completionTokens: 2 }, finishReason: 'stop' }
}

interface Harness {
  host: ResearchHost
  events: ResearchEvent[]
  reads: string[]
  searches: string[]
  peakReads: number
}

function harness(options: { hits?: SearchHit[] | null; failRead?: string } = {}): Harness {
  const hits = options.hits ?? [
    { url: PRO, title: PAGES[PRO]!.title, snippet: 'meter study' },
    { url: CON, title: PAGES[CON]!.title, snippet: 'cold climate' },
    { url: BREAD, title: PAGES[BREAD]!.title, snippet: 'bread' },
  ]
  let live = 0
  const state: Harness = {
    events: [],
    reads: [],
    searches: [],
    peakReads: 0,
    host: {
      async search(query) {
        state.searches.push(query)
        await new Promise((resolve) => setTimeout(resolve, 1))
        return hits
      },
      async readPage(url) {
        live += 1
        state.peakReads = Math.max(state.peakReads, live)
        state.reads.push(url)
        await new Promise((resolve) => setTimeout(resolve, 2))
        live -= 1
        if (url === options.failRead) throw new Error('net::ERR_CONNECTION_RESET')
        return PAGES[url] ?? null
      },
    },
  }
  return state
}

function scripted(rules: { scores?: Record<string, string>; answer?: string }): ResearchComplete {
  return async (messages) => {
    const system = messages[0]?.content ?? ''
    const user = messages[1]?.content ?? ''
    if (system.includes('decompose a research question')) {
      return reply(JSON.stringify([
        { question: 'Do heat pumps cut heating bills?', queries: ['heat pump heating bill savings'] },
        { question: 'How do heat pumps perform in cold weather?', queries: ['heat pump cold climate performance'] },
        { question: 'What do installers say about heat pump savings?', queries: ['installer heat pump savings'] },
      ]))
    }
    if (system.includes('judge one web page')) {
      const url = /Page URL: (\S+)/.exec(user)?.[1] ?? ''
      return reply(rules.scores?.[url] ?? '{"relevance":0.2,"credibility":0.5,"quotes":[],"claims":[]}')
    }
    if (system.includes('Summarise what this source')) return reply(JSON.stringify({ summary: 'A source summary.' }))
    if (system.includes('decide whether its claims')) return reply(JSON.stringify({ clusters: [] }))
    if (system.includes('write a research answer')) return reply(rules.answer ?? 'Savings are real [1] but contested at low temperatures [2][7].')
    return reply('{}')
  }
}

const SCORES: Record<string, string> = {
  [PRO]: '{"relevance":0.95,"credibility":0.8,"quotes":["Heat pumps cut heating bills by 40 percent in our metering study."],"claims":["Heat pumps cut heating bills by 40 percent."]}',
  [CON]: '{"relevance":0.9,"credibility":0.6,"quotes":[],"claims":["Heat pumps do not cut heating bills below minus seven degrees."]}',
  [BREAD]: '{"relevance":0.05,"credibility":0.3,"quotes":[],"claims":[]}',
}

// Each test needs the harness it created, so build them together.
function setup(over: { hits?: SearchHit[] | null; failRead?: string } = {}) {
  const h = harness(over)
  const input = (extra: Partial<Parameters<typeof runResearch>[0]> = {}): Parameters<typeof runResearch>[0] => ({
    id: 'run-1',
    question: 'Do heat pumps save money?',
    depth: 'quick',
    host: h.host,
    onEvent: (event) => h.events.push(event),
    signal: new AbortController().signal,
    ...extra,
  })
  return { h, input }
}

describe('runResearch without a model', () => {
  it('plans deterministic angles, keeps on-topic notes and never pays for scoring', async () => {
    const { h, input } = setup()
    const result = await runResearch(input())

    expect(result.sources.map((note) => note.url).sort()).toEqual([CON, PRO])
    expect(result.discarded.map((entry) => entry.url)).toContain(BREAD)
    expect(result.discarded.find((entry) => entry.url === BREAD)?.reason).toContain('off-topic')
    expect(h.events.filter((event) => event.type === 'note')).toHaveLength(2)
    expect(result.promptTokens).toBe(0)
  })

  it('still produces a cited, contradiction-flagged report', async () => {
    const { input } = setup()
    const result = await runResearch(input())
    expect(result.answer).toContain('Contested')
    expect(result.citations).toHaveLength(2)
    expect(result.contradictions).toHaveLength(1)
    expect(result.clusters.length).toBeGreaterThan(0)
    expect(result.brief.length).toBeGreaterThan(0)
  })

  it('reads each url once even when several queries return it', async () => {
    const { h, input } = setup()
    await runResearch(input({ concurrency: 1 }))
    const uniqueReads = new Set(h.reads)
    expect(h.reads.length).toBe(uniqueReads.size)
  })

  it('keeps going when one page cannot be read', async () => {
    const { h, input } = setup({ failRead: PRO })
    const result = await runResearch(input({ concurrency: 1 }))
    expect(result.discarded.find((entry) => entry.url === PRO)?.reason).toContain('could not be read')
    expect(result.sources.map((note) => note.url)).toEqual([CON])
    expect(h.reads).toContain(PRO)
  })
})

describe('runResearch with a model', () => {
  it('sends only plausible pages to the scoring pass', async () => {
    const { input } = setup()
    let judged: string[] = []
    const complete: ResearchComplete = async (messages, kind) => {
      const system = messages[0]?.content ?? ''
      const user = messages[1]?.content ?? ''
      if (system.includes('judge one web page')) judged.push(user)
      if (system.includes('decompose')) return reply('not a plan at all')
      if (system.includes('judge one web page')) return reply(SCORES[user.match(/Page URL: (\S+)/)?.[1] ?? ''] ?? '{"relevance":0.1}')
      if (system.includes('Summarise')) return reply('{"summary":"Short summary."}')
      if (system.includes('write a research answer')) return reply('Savings hold up [1].')
      return reply('{}')
    }
    const result = await runResearch(input({ complete }))
    expect(joined(judged)).not.toContain('Sourdough')
    expect(result.sources).toHaveLength(2)
    expect(result.promptTokens).toBeGreaterThan(0)
    expect(result.sources.every((note) => note.summary === 'Short summary.')).toBe(true)
  })

  it('discards a page the scorer rates below the floor', async () => {
    const { input } = setup({ hits: [
      { url: PRO, title: PAGES[PRO]!.title, snippet: 'meter study' },
      { url: CON, title: PAGES[CON]!.title, snippet: 'cold climate' },
    ] })
    const result = await runResearch(
      input({
        complete: async (messages) => {
          const system = messages[0]?.content ?? ''
          if (system.includes('decompose')) {
            return reply('[{"question":"Do heat pumps save money?","queries":["heat pump savings"]},{"question":"Do they work cold?","queries":["heat pump cold"]},{"question":"What do installers say?","queries":["installer opinion"]}]')
          }
          if (system.includes('judge one web page')) return reply('{"relevance":0.05,"credibility":0.4,"quotes":[],"claims":[]}')
          return reply('{}')
        },
      }),
    )
    expect(result.sources).toHaveLength(0)
    expect(result.discarded.every((entry) => entry.reason.includes('below'))).toBe(true)
    expect(result.answer).toContain('No usable sources')
  })

  it('strips citation numbers that were never issued', async () => {
    const { input } = setup()
    const result = await runResearch(input({ complete: scripted({ scores: SCORES }) }))
    const valid = new Set(result.citations.map((citation) => citation.n))
    for (const match of result.answer.matchAll(/\[(\d+)\]/g)) {
      expect(valid.has(Number(match[1]))).toBe(true)
    }
    expect(result.answer).toContain('contested at low temperatures [2]')
  })

  it('uses the plan the model returned, not the fallback', async () => {
    const { h, input } = setup()
    await runResearch(input({ complete: scripted({ scores: SCORES }) }))
    expect(h.searches.length).toBe(3)
    expect(h.searches).toContain('heat pump heating bill savings')
  })

  it('caps parallel work at the requested concurrency', async () => {
    const { h, input } = setup({ hits: [
      { url: PRO, title: PAGES[PRO]!.title, snippet: 'a' },
      { url: CON, title: PAGES[CON]!.title, snippet: 'b' },
      { url: BREAD, title: PAGES[BREAD]!.title, snippet: 'c' },
    ] })
    await runResearch(input({ concurrency: 2 }))
    expect(h.peakReads).toBeLessThanOrEqual(2)
  })

  it('refuses a concurrency above the tab ceiling', async () => {
    const { h, input } = setup()
    await runResearch(input({ concurrency: 40 }))
    expect(h.peakReads).toBeLessThanOrEqual(MAX_CONCURRENCY)
  })
})

describe('gather rounds', () => {
  const PLAN = [
    { question: 'Do heat pumps cut heating bills?', queries: ['heat pump bills'] },
    { question: 'Do heat pumps save money overall?', queries: ['heat pump savings'] },
    { question: 'How loud are heat pumps outdoors?', queries: ['heat pump outdoor noise'] },
    { question: 'Who installs heat pumps?', queries: ['heat pump installer'] },
    { question: 'What do heat pump warranties cover?', queries: ['heat pump warranty'] },
  ]

  function planner(min: number): ResearchComplete {
    return async (messages) => {
      const system = messages[0]?.content ?? ''
      const user = messages[1]?.content ?? ''
      if (system.includes('decompose')) return reply(JSON.stringify(PLAN.slice(0, min)))
      if (system.includes('judge one web page')) return reply(SCORES[/Page URL: (\S+)/.exec(user)?.[1] ?? ''] ?? '{"relevance":0.1}')
      if (system.includes('Summarise')) return reply('{"summary":"Summary."}')
      if (system.includes('write a research answer')) return reply('Heat pumps cut heating bills by 40 percent [1] and savings need a meter study [2].')
      return reply('{}')
    }
  }

  it('standard depth stops after one round and records the gaps', async () => {
    const { h, input } = setup()
    const result = await runResearch(input({ depth: 'standard', complete: planner(4) }))
    expect(result.rounds).toBe(1)
    expect(result.gaps).toEqual(['How loud are heat pumps outdoors?'])
    expect(h.events.filter((event) => event.type === 'gaps')).toHaveLength(0)
  })

  it('deep depth searches the gaps a second time', async () => {
    const { h, input } = setup()
    const result = await runResearch(input({ depth: 'deep', complete: planner(5) }))
    expect(result.rounds).toBe(2)
    expect(h.events.filter((event) => event.type === 'gaps')).toHaveLength(1)
    // The gap query is generated from the uncovered sub-question, not reused.
    expect(h.searches.filter((query) => query.includes('evidence'))).toContain('loud heat pump outdoor evidence')
  })
})

describe('stopping a run', () => {
  it('aborts between pages and rejects', async () => {
    const controller = new AbortController()
    const { h, input } = setup()
    const promise = runResearch(
      input({
        signal: controller.signal,
        concurrency: 1,
        onEvent: (event) => {
          h.events.push(event)
          if (event.type === 'scored') controller.abort()
        },
      }),
    )
    await expect(promise).rejects.toThrow('Research was stopped.')
    expect(h.reads.length).toBeLessThan(3)
  })
})

function joined(parts: string[]): string {
  return parts.join('\n')
}
