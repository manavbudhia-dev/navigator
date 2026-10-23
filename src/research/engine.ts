import {
  buildPlanMessages,
  buildScoreMessages,
  buildSummaryMessages,
  fallbackPlan,
  parsePlan,
  parseScores,
  parseSummary,
} from '@/prompts/research'
import { isBlocked } from '@/safety/siteRules'
import { buildNote, ensureClaims, keywordGate, PREFILTER_FLOOR } from './notes'
import { runPool, withTimeout } from './pool'
import {
  bulletBrief,
  citationsOf,
  clusterClaims,
  composeAnswer,
  confirmContradictions,
  contradictionsOf,
  findGaps,
  orderSources,
  usageOf,
} from './synthesize'
import { contentTokens, unique } from './text'
import {
  clampConcurrency,
  DEPTH_PLANS,
  DEFAULT_CONCURRENCY,
  RELEVANCE_FLOOR,
  type ClaimCluster,
  type Citation,
  type Contradiction,
  type DiscardedSource,
  type PageArticle,
  type ResearchComplete,
  type ResearchDepth,
  type ResearchEvent,
  type ResearchHost,
  type ResearchResult,
  type SourceNote,
  type SubQuestion,
} from './types'

/**
 * The research pipeline (spec §7): PLAN → GATHER → score → SYNTHESISE, plus a
 * second gather round in deep mode. Chrome and the model are both injected, so
 * this file runs identically in tests and in the service worker.
 */

export interface ResearchInput {
  id: string
  question: string
  depth: ResearchDepth
  host: ResearchHost
  complete?: ResearchComplete
  onEvent: (event: ResearchEvent) => void
  signal: AbortSignal
  concurrency?: number
  readTimeoutMs?: number
  /** Sites the user closed: a hit on one is never opened (spec §9). */
  blockedSites?: readonly string[]
}

interface GatherOutcome {
  note: SourceNote | null
  discarded: DiscardedSource | null
  promptTokens: number
  completionTokens: number
}

/** A page that hangs is a page we never opened. */
const READ_TIMEOUT_MS = 25_000

function stopped(): Error {
  const error = new Error('Research was stopped.')
  error.name = 'AbortError'
  return error
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw stopped()
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Ask the planner for sub-questions; fall back to fixed research angles. */
export async function buildPlan(
  question: string,
  depth: ResearchDepth,
  complete: ResearchComplete | undefined,
  signal: AbortSignal,
): Promise<{ subQuestions: SubQuestion[]; promptTokens: number; completionTokens: number }> {
  const bounds = DEPTH_PLANS[depth].subQuestions
  if (complete === undefined) {
    return { subQuestions: fallbackPlan(question, bounds[0]), promptTokens: 0, completionTokens: 0 }
  }
  try {
    const result = await complete(buildPlanMessages(question, depth, bounds), 'big', signal)
    const parsed = parsePlan(result.message.content ?? '', question, bounds)
    if (parsed.length === 0) {
      return { subQuestions: fallbackPlan(question, bounds[1]), promptTokens: 0, completionTokens: 0 }
    }
    return {
      subQuestions: parsed,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    }
  } catch (error) {
    if (signal.aborted) throw error
    return { subQuestions: fallbackPlan(question, bounds[1]), promptTokens: 0, completionTokens: 0 }
  }
}

/** Turn an unanswered sub-question into a narrower second-round angle. */
export function gapToSubQuestion(gap: string, id: string): SubQuestion {
  const joined = unique(contentTokens(gap)).slice(0, 6).join(' ')
  return {
    id,
    question: gap.length > 200 ? `${gap.slice(0, 199)}…` : gap,
    queries: unique([`${joined} evidence`, `${joined} criticism`]).slice(0, 2),
  }
}

/** A site the user closed is never opened, and the report says why it was skipped. */
function blockedSite(hit: { url: string; title: string }): GatherOutcome {
  return {
    note: null,
    discarded: { url: hit.url, title: hit.title, relevance: 0, reason: 'site is on your blocked list' },
    promptTokens: 0,
    completionTokens: 0,
  }
}

/** Relevance under the floor costs us no summarisation tokens (spec §7). */
function belowFloor(article: PageArticle, relevance: number): GatherOutcome {
  return {
    note: null,
    discarded: {
      url: article.url,
      title: article.title,
      relevance: round(relevance),
      reason: `relevance ${round(relevance)} is below ${RELEVANCE_FLOOR}`,
    },
    promptTokens: 0,
    completionTokens: 0,
  }
}

/** Relevance gate + note build. The keyword pre-filter runs before any model call. */
async function scoreAndNote(
  sub: SubQuestion,
  article: PageArticle,
  runId: string,
  complete: ResearchComplete | undefined,
  signal: AbortSignal,
): Promise<GatherOutcome> {
  const gate = keywordGate(sub, article)
  if (gate < PREFILTER_FLOOR) {
    return {
      note: null,
      discarded: { url: article.url, title: article.title, relevance: round(gate), reason: 'off-topic: no keyword overlap' },
      promptTokens: 0,
      completionTokens: 0,
    }
  }

  if (complete === undefined) {
    if (gate < RELEVANCE_FLOOR) return belowFloor(article, gate)
    const note = ensureClaims(buildNote({ runId, subQuestion: sub, article, scores: null, relevance: gate }))
    return { note, discarded: null, promptTokens: 0, completionTokens: 0 }
  }

  try {
    const result = await complete(buildScoreMessages(sub, article), 'small', signal)
    const scores = parseScores(result.message.content ?? '')
    const relevance = scores === null ? gate : Math.min(1, scores.relevance * 0.7 + gate * 0.3)
    const usage = { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens }

    if (relevance < RELEVANCE_FLOOR) {
      return { ...belowFloor(article, relevance), ...usage }
    }
    const note = ensureClaims(buildNote({ runId, subQuestion: sub, article, scores, relevance }))
    return { note, discarded: null, ...usage }
  } catch (error) {
    if (signal.aborted) throw error
    // A failed scoring pass must not lose the page: keep it on heuristics only.
    const note = ensureClaims(buildNote({ runId, subQuestion: sub, article, scores: null, relevance: gate }))
    return { note, discarded: null, promptTokens: 0, completionTokens: 0 }
  }
}

/**
 * One gather pass: search every query through the bounded pool, read at most
 * `pagesPerQuery` unseen pages per query, score them, keep the notes.
 */
async function gather(
  input: ResearchInput,
  subQuestions: SubQuestion[],
  seen: Set<string>,
): Promise<{ notes: SourceNote[]; discarded: DiscardedSource[]; promptTokens: number; completionTokens: number }> {
  const plan = DEPTH_PLANS[input.depth]
  const blocked = input.blockedSites ?? []
  const tasks: { sub: SubQuestion; query: string }[] = []
  for (const sub of subQuestions) {
    for (const query of sub.queries.slice(0, plan.queriesPerSub)) {
      tasks.push({ sub, query })
    }
  }

  const outcomes = await runPool(
    tasks,
    clampConcurrency(input.concurrency ?? DEFAULT_CONCURRENCY),
    async (task) => {
      checkAbort(input.signal)
      const local: GatherOutcome[] = []
      let hits: { url: string; title: string; snippet: string }[] = []
      try {
        hits = await input.host.search(task.query, plan.pagesPerQuery * 3, input.signal)
      } catch (error) {
        if (input.signal.aborted) throw error
        hits = []
      }
      input.onEvent({ type: 'search', query: task.query, hits: hits.length })

      let opened = 0
      for (const hit of hits) {
        if (opened >= plan.pagesPerQuery) break
        checkAbort(input.signal)
        if (seen.has(hit.url)) continue
        seen.add(hit.url)
        // A blocked site costs a slot in the report but never a tab: skipping
        // it silently would leave the user wondering where the source went.
        if (isBlocked(hit.url, blocked)) {
          local.push(blockedSite(hit))
          continue
        }
        opened += 1

        input.onEvent({ type: 'open', url: hit.url, title: hit.title })
        let article: PageArticle | null = null
        try {
          article = await withTimeout(input.host.readPage(hit.url, input.signal), input.readTimeoutMs ?? READ_TIMEOUT_MS)
        } catch (error) {
          if (input.signal.aborted) throw error
          article = null
        }
        if (article === null) {
          local.push({
            note: null,
            discarded: { url: hit.url, title: hit.title, relevance: 0, reason: 'page could not be read' },
            promptTokens: 0,
            completionTokens: 0,
          })
          continue
        }

        const outcome = await scoreAndNote(task.sub, article, input.id, input.complete, input.signal)
        input.onEvent({
          type: 'scored',
          url: hit.url,
          title: article.title,
          relevance: outcome.note?.relevance ?? outcome.discarded?.relevance ?? 0,
          kept: outcome.note !== null,
        })
        if (outcome.note !== null) {
          input.onEvent({
            type: 'note',
            url: outcome.note.url,
            title: outcome.note.title,
            credibility: outcome.note.credibility,
            claims: outcome.note.claims.length,
          })
        }
        local.push(outcome)
      }
      return local
    },
    input.signal,
  )

  const notes: SourceNote[] = []
  const discarded: DiscardedSource[] = []
  let promptTokens = 0
  let completionTokens = 0
  for (const list of outcomes) {
    for (const outcome of list) {
      if (outcome.note !== null) notes.push(outcome.note)
      if (outcome.discarded !== null) discarded.push(outcome.discarded)
      promptTokens += outcome.promptTokens
      completionTokens += outcome.completionTokens
    }
  }
  return { notes, discarded, promptTokens, completionTokens }
}

/** Map step: one cheap summary per source, so the reduce pass stays small. */
async function summarize(
  notes: SourceNote[],
  complete: ResearchComplete | undefined,
  concurrency: number,
  signal: AbortSignal,
): Promise<{ notes: SourceNote[]; promptTokens: number; completionTokens: number }> {
  if (complete === undefined) {
    return {
      notes: notes.map((note) => ({ ...note, summary: note.claims[0] ?? note.title })),
      promptTokens: 0,
      completionTokens: 0,
    }
  }
  let promptTokens = 0
  let completionTokens = 0
  const summarized = await runPool(
    notes,
    concurrency,
    async (note) => {
      try {
        const result = await complete(
          buildSummaryMessages({ title: note.title, url: note.url, claims: note.claims }),
          'small',
          signal,
        )
        promptTokens += result.usage.promptTokens
        completionTokens += result.usage.completionTokens
        return { ...note, summary: parseSummary(result.message.content ?? '') || note.claims[0] || note.title }
      } catch (error) {
        if (signal.aborted) throw error
        return { ...note, summary: note.claims[0] ?? note.title }
      }
    },
    signal,
  )
  return { notes: summarized, promptTokens, completionTokens }
}

export async function runResearch(input: ResearchInput): Promise<ResearchResult> {
  const startedAt = Date.now()
  const plan = DEPTH_PLANS[input.depth]
  const concurrency = clampConcurrency(input.concurrency ?? DEFAULT_CONCURRENCY)
  input.onEvent({ type: 'started', question: input.question, depth: input.depth })

  checkAbort(input.signal)
  const planned = await buildPlan(input.question, input.depth, input.complete, input.signal)
  input.onEvent({ type: 'plan', subQuestions: planned.subQuestions })

  const seen = new Set<string>()
  const notes: SourceNote[] = []
  const discarded: DiscardedSource[] = []
  const usages = [{ promptTokens: planned.promptTokens, completionTokens: planned.completionTokens }]
  let subQuestions = planned.subQuestions

  interface Round {
    answer: string
    citations: Citation[]
    clusters: ClaimCluster[]
    contradictions: Contradiction[]
    brief: string[]
    gaps: string[]
    ordered: SourceNote[]
    rounds: number
  }

  async function runRound(roundNumber: number): Promise<Round> {
    input.onEvent({ type: 'round', round: roundNumber })
    const gathered = await gather(input, subQuestions, seen)
    notes.push(...gathered.notes)
    discarded.push(...gathered.discarded)
    usages.push(gathered)

    const orderedInput = dedupeNotes(notes)
    input.onEvent({ type: 'synthesis', round: roundNumber, sources: orderedInput.length })

    const summaryPass = await summarize(orderedInput, input.complete, concurrency, input.signal)
    usages.push(summaryPass)
    const kept = summaryPass.notes
    const clusters = clusterClaims(kept)
    const conflictPass = await confirmContradictions(clusters, input.complete, input.signal)
    usages.push(conflictPass)
    const citations = citationsOf(orderSources(kept))
    const answerPass = await composeAnswer(input.question, conflictPass.clusters, citations, kept, input.complete, input.signal)
    usages.push(answerPass)
    const gaps = findGaps(subQuestions, answerPass.answer)

    return {
      answer: answerPass.answer,
      citations,
      clusters: conflictPass.clusters,
      contradictions: contradictionsOf(conflictPass.clusters),
      brief: bulletBrief(conflictPass.clusters),
      gaps,
      ordered: kept,
      rounds: roundNumber,
    }
  }

  let result = await runRound(1)
  if (plan.rounds >= 2) {
    input.onEvent({ type: 'gaps', gaps: result.gaps })
    if (result.gaps.length > 0) {
      subQuestions = [
        ...subQuestions,
        ...result.gaps
          .slice(0, plan.subQuestions[1])
          .map((gap, i) => gapToSubQuestion(gap, `g${i + 1}`)),
      ]
      result = await runRound(2)
    }
  }

  checkAbort(input.signal)
  const total = usageOf(usages)
  const finished: ResearchResult = {
    id: input.id,
    question: input.question,
    depth: input.depth,
    createdAt: startedAt,
    answer: result.answer,
    brief: result.brief,
    citations: result.citations,
    clusters: result.clusters,
    contradictions: result.contradictions,
    sources: result.ordered,
    discarded,
    gaps: result.gaps,
    rounds: result.rounds,
    promptTokens: total.promptTokens,
    completionTokens: total.completionTokens,
  }
  input.onEvent({ type: 'done', result: finished })
  return finished
}

function dedupeNotes(list: readonly SourceNote[]): SourceNote[] {
  const byUrl = new Map<string, SourceNote>()
  for (const note of list) {
    const existing = byUrl.get(note.url)
    if (existing === undefined || note.relevance > existing.relevance) byUrl.set(note.url, note)
  }
  return [...byUrl.values()]
}
