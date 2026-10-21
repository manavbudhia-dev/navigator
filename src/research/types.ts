import type { ChatMessage, CompletionResult } from '@/llm/types'

/**
 * Research engine vocabulary (spec §7). Everything here is provider- and
 * browser-free: the engine talks to Chrome through `ResearchHost` and to the
 * model through `complete`, so it runs unchanged in tests and scripts.
 */

export type ResearchDepth = 'quick' | 'standard' | 'deep'

export interface DepthPlan {
  /** [min, max] sub-questions the planner is allowed to emit. */
  subQuestions: [number, number]
  queriesPerSub: number
  /** Candidate pages opened per query. */
  pagesPerQuery: number
  /** Gather rounds — deep mode runs a second round on the discovered gaps. */
  rounds: number
}

export const DEPTH_PLANS: Record<ResearchDepth, DepthPlan> = {
  quick: { subQuestions: [3, 4], queriesPerSub: 1, pagesPerQuery: 2, rounds: 1 },
  standard: { subQuestions: [4, 6], queriesPerSub: 2, pagesPerQuery: 2, rounds: 1 },
  deep: { subQuestions: [5, 8], queriesPerSub: 2, pagesPerQuery: 3, rounds: 2 },
}

/** Below this a source is dropped and no summarisation tokens are spent on it. */
export const RELEVANCE_FLOOR = 0.4

/** Queue-based tab pool bounds (spec §7: default 4, never more than 8). */
export const DEFAULT_CONCURRENCY = 4
export const MAX_CONCURRENCY = 8

export function clampConcurrency(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(value))) : DEFAULT_CONCURRENCY
}

export interface SubQuestion {
  id: string
  question: string
  queries: string[]
}

export interface SearchHit {
  url: string
  title: string
  snippet: string
}

/** One page as the gather loop sees it, after main-content extraction. */
export interface PageArticle {
  url: string
  title: string
  text: string
  author: string | null
  publishDate: string | null
}

/** What the content script sends back: the article plus its raw links. */
export interface ArticlePayload extends PageArticle {
  /** Unranked anchors — a results page is turned into hits by `rankHits`. */
  links: { url: string; title: string; snippet: string }[]
}

export interface SourceNote {
  id: string
  runId: string
  url: string
  title: string
  subQuestionId: string
  author: string | null
  publishDate: string | null
  /** Trimmed main text — kept so follow-up chat can search the corpus. */
  text: string
  snippetQuotes: string[]
  claims: string[]
  relevance: number
  credibility: number
  summary: string
}

export interface DiscardedSource {
  url: string
  title: string
  relevance: number
  reason: string
}

export interface ClaimSource {
  sourceId: string
  claim: string
}

export interface ClaimCluster {
  id: string
  text: string
  sources: ClaimSource[]
  agreement: 'single' | 'agreement' | 'contradiction'
}

export interface Contradiction {
  clusterId: string
  topic: string
  sides: ClaimSource[]
}

export interface Citation {
  n: number
  sourceId: string
  url: string
  title: string
}

export interface ResearchResult {
  id: string
  question: string
  depth: ResearchDepth
  createdAt: number
  answer: string
  /** One-line-per-cluster brief shown in the panel and the txt export. */
  brief: string[]
  /** Flattened citation markers in the answer, numbered in source order. */
  citations: Citation[]
  clusters: ClaimCluster[]
  contradictions: Contradiction[]
  sources: SourceNote[]
  discarded: DiscardedSource[]
  /** Sub-questions the first round could not answer (deep mode feeds round 2). */
  gaps: string[]
  rounds: number
  promptTokens: number
  completionTokens: number
}

export type ResearchEvent =
  | { type: 'started'; question: string; depth: ResearchDepth }
  | { type: 'plan'; subQuestions: SubQuestion[] }
  | { type: 'search'; query: string; hits: number }
  | { type: 'open'; url: string; title: string }
  | { type: 'scored'; url: string; title: string; relevance: number; kept: boolean }
  | { type: 'note'; url: string; title: string; credibility: number; claims: number }
  | { type: 'round'; round: number }
  | { type: 'synthesis'; round: number; sources: number }
  | { type: 'gaps'; gaps: string[] }
  | { type: 'done'; result: ResearchResult }
  | { type: 'failed'; error: string }

export interface ResearchEventMessage {
  source: 'navigator-research'
  event: ResearchEvent
}

export function isResearchEventMessage(value: unknown): value is ResearchEventMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ResearchEventMessage).source === 'navigator-research' &&
    typeof (value as ResearchEventMessage).event === 'object'
  )
}

/** Browser side of the engine: whatever a real tab can do, nothing more. */
export interface ResearchHost {
  search(query: string, limit: number, signal: AbortSignal): Promise<SearchHit[]>
  readPage(url: string, signal: AbortSignal): Promise<PageArticle | null>
}

export type ResearchComplete = (
  messages: ChatMessage[],
  kind: 'big' | 'small',
  signal?: AbortSignal,
) => Promise<CompletionResult>
