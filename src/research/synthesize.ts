import { buildAnswerMessages, buildConflictMessages, parseConflicts, uncoveredTerms } from '@/prompts/research'
import { clip, contentTokens, polarity, unique } from './text'
import type { TokenUsage } from '@/llm/types'
import type { ResearchComplete } from './types'
import type {
  Citation,
  ClaimCluster,
  Contradiction,
  ResearchResult,
  SourceNote,
  SubQuestion,
} from './types'

/**
 * Synthesis (spec §7): map-reduce over the notes. Claim clustering and
 * contradiction detection are deterministic first, then one cheap model pass
 * confirms the close calls — the engine must never silently pick a side.
 */

export const CLAIM_SIMILARITY = 0.34
export const MAX_CLUSTERS = 14

/** Most relevant source first; citation numbers follow this order. */
export function orderSources(notes: readonly SourceNote[]): SourceNote[] {
  return [...notes].sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance
    if (b.credibility !== a.credibility) return b.credibility - a.credibility
    return a.title.localeCompare(b.title)
  })
}

export function citationsOf(ordered: readonly SourceNote[]): Citation[] {
  return ordered.map((note, i) => ({
    n: i + 1,
    sourceId: note.id,
    url: note.url,
    title: note.title,
  }))
}

/** Merge claims that talk about the same thing; keep every contributing source. */
export function clusterClaims(notes: readonly SourceNote[]): ClaimCluster[] {
  interface Draft {
    text: string
    terms: Set<string>
    sources: { sourceId: string; claim: string; credibility: number }[]
  }
  const drafts: Draft[] = []

  for (const note of notes) {
    for (const claim of note.claims) {
      const terms = new Set(contentTokens(claim))
      let best = -1
      let bestScore = 0
      for (let i = 0; i < drafts.length; i += 1) {
        const draft = drafts[i]!
        let shared = 0
        for (const term of terms) {
          if (draft.terms.has(term)) shared += 1
        }
        // Overlap measured against the shorter claim: metered findings and
        // their rebuttals are long, so plain Jaccard would never merge them.
        const smaller = Math.min(draft.terms.size, terms.size)
        const score = smaller === 0 ? 0 : shared / smaller
        if (score > bestScore) {
          bestScore = score
          best = i
        }
      }

      const alreadyInside = best >= 0 && bestScore >= CLAIM_SIMILARITY
      if (alreadyInside) {
        const draft = drafts[best]!
        if (!draft.sources.some((entry) => entry.sourceId === note.id)) {
          draft.sources.push({ sourceId: note.id, claim, credibility: note.credibility })
        }
        for (const term of terms) draft.terms.add(term)
        if (claim.length > draft.text.length && claim.length <= 300) draft.text = claim
      } else {
        drafts.push({
          text: claim,
          terms,
          sources: [{ sourceId: note.id, claim, credibility: note.credibility }],
        })
      }
    }
  }

  return drafts
    .filter((draft) => draft.sources.length > 0)
    .sort((a, b) => {
      if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length
      return Math.max(...b.sources.map((s) => s.credibility)) - Math.max(...a.sources.map((s) => s.credibility))
    })
    .slice(0, MAX_CLUSTERS)
    .map((draft, i) => {
      const marks = draft.sources.map((entry) => polarity(entry.claim))
      const hasPositive = marks.includes(0) || marks.includes(1)
      const hasNegative = marks.includes(-1)
      const multi = draft.sources.length > 1
      return {
        id: `c${i + 1}`,
        text: clip(draft.text, 300),
        sources: draft.sources.map((entry) => ({ sourceId: entry.sourceId, claim: entry.claim })),
        agreement: !multi ? 'single' : hasPositive && hasNegative ? 'contradiction' : 'agreement',
      }
    })
}

/** Deterministic contradictions, straight from the clusters. */
export function contradictionsOf(clusters: readonly ClaimCluster[]): Contradiction[] {
  return clusters
    .filter((cluster) => cluster.agreement === 'contradiction')
    .map((cluster) => ({ clusterId: cluster.id, topic: cluster.text, sides: cluster.sources }))
}

/**
 * Ask the cheap model about the clusters that could go either way and merge
 * its verdicts in. A model that says "agree" overrules the negation heuristic;
 * one that says "conflict" adds a contradiction we would otherwise have missed.
 */
export async function confirmContradictions(
  clusters: ClaimCluster[],
  complete: ResearchComplete | undefined,
  signal?: AbortSignal,
): Promise<{ clusters: ClaimCluster[]; promptTokens: number; completionTokens: number }> {
  const ambiguous = clusters.filter((cluster) => cluster.sources.length > 1)
  const empty = { clusters, promptTokens: 0, completionTokens: 0 }
  if (complete === undefined || ambiguous.length === 0) return empty

  try {
    const result = await complete(buildConflictMessages(ambiguous), 'small', signal)
    const verdicts = parseConflicts(result.message.content ?? '')
    const next = clusters.map((cluster) => {
      const verdict = verdicts.get(cluster.id)
      if (verdict === undefined) return cluster
      if (verdict === 'conflict') return { ...cluster, agreement: 'contradiction' as const }
      if (verdict === 'agree') return { ...cluster, agreement: 'agreement' as const }
      return { ...cluster, agreement: 'single' as const, sources: cluster.sources.slice(0, 1) }
    })
    return { clusters: next, promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens }
  } catch {
    return empty
  }
}

/** Remove bracketed numbers we never issued — a citation must resolve. */
export function validateCitations(text: string, valid: ReadonlySet<number>): string {
  return text
    .replace(/\[(\d{1,3})\]/g, (whole, digits: string) => (valid.has(Number(digits)) ? whole : ''))
    .replace(/ {2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
}

export function countCitations(text: string): number {
  const matches = text.match(/\[\d{1,3}\]/g)
  return matches === null ? 0 : new Set(matches).size
}

export interface AnswerDraft {
  answer: string
  promptTokens: number
  completionTokens: number
}

/** The reduce step: one big-model pass over the clustered evidence. */
export async function composeAnswer(
  question: string,
  clusters: readonly ClaimCluster[],
  citations: readonly Citation[],
  notes: readonly SourceNote[],
  complete: ResearchComplete | undefined,
  signal?: AbortSignal,
): Promise<AnswerDraft> {
  const idToNumber = new Map(citations.map((citation) => [citation.sourceId, citation.n]))
  const valid = new Set(citations.map((citation) => citation.n))

  if (complete === undefined || clusters.length === 0) {
    return { answer: deterministicAnswer(clusters, idToNumber), promptTokens: 0, completionTokens: 0 }
  }

  const byId = new Map(notes.map((note) => [note.id, note]))
  const numbered = citations.map((citation) => {
    const note = byId.get(citation.sourceId)
    return { id: citation.sourceId, n: citation.n, title: citation.title, url: note?.url ?? citation.url }
  })

  try {
    const result = await complete(buildAnswerMessages(question, [...clusters], numbered), 'big', signal)
    const text = (result.message.content ?? '').trim()
    if (text === '') return { answer: deterministicAnswer(clusters, idToNumber), promptTokens: 0, completionTokens: 0 }
    return {
      answer: validateCitations(text, valid),
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    }
  } catch {
    return { answer: deterministicAnswer(clusters, idToNumber), promptTokens: 0, completionTokens: 0 }
  }
}

/** No model, no problem: the report is still readable and still cited. */
export function deterministicAnswer(
  clusters: readonly ClaimCluster[],
  idToNumber: ReadonlyMap<string, number>,
): string {
  if (clusters.length === 0) return 'No usable sources were found, so there is nothing to report.'
  const lines = ['# Findings', '']
  for (const cluster of clusters) {
    const marks = unique(
      cluster.sources
        .map((entry) => idToNumber.get(entry.sourceId))
        .filter((n): n is number => n !== undefined)
        .map((n) => `[${n}]`),
    )
    const suffix = marks.length > 0 ? ` ${marks.join('')}` : ''
    if (cluster.agreement === 'contradiction') {
      lines.push(`**Contested:** ${cluster.text}${suffix}`)
      for (const entry of cluster.sources) {
        const n = idToNumber.get(entry.sourceId)
        lines.push(`- ${entry.claim}${n === undefined ? '' : ` [${n}]`}`)
      }
      lines.push('')
    } else {
      lines.push(`- ${cluster.text}${suffix}`)
    }
  }
  return lines.join('\n').trim()
}

export function findGaps(subQuestions: readonly SubQuestion[], answer: string): string[] {
  return uncoveredTerms([...subQuestions], answer).map((sub) => sub.question)
}

/** Lead sentences make the bullet brief (spec §7 output formats). */
export function bulletBrief(clusters: readonly ClaimCluster[], max = 6): string[] {
  return clusters.slice(0, max).map((cluster) => clip(cluster.text, 220))
}

export function usageOf(
  parts: readonly Pick<TokenUsage, 'promptTokens' | 'completionTokens'>[],
): Pick<ResearchResult, 'promptTokens' | 'completionTokens'> {
  let promptTokens = 0
  let completionTokens = 0
  for (const part of parts) {
    promptTokens += part.promptTokens
    completionTokens += part.completionTokens
  }
  return { promptTokens, completionTokens }
}
