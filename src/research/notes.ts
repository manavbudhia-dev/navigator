import { hostReputation } from './search'
import { clip, contentTokens, coverage, sentences, unique } from './text'
import type { ModelScores } from '@/prompts/research'
import type { PageArticle, SourceNote, SubQuestion } from './types'

/**
 * Per-source note builder (spec §7). The heuristics here run before any model
 * call, so an obviously off-topic page costs nothing.
 */

/** Cheap keyword gate: below this the page never reaches the scoring model. */
export const PREFILTER_FLOOR = 0.12

/** Chars of page text we keep in the note for follow-up retrieval. */
export const NOTE_TEXT_BUDGET = 12_000

export function queryTerms(subQuestion: SubQuestion): string[] {
  return unique(contentTokens(`${subQuestion.question} ${subQuestion.queries.join(' ')}`)).slice(0, 12)
}

/** Title counts double: a page about the topic says so in its headline. */
export function keywordGate(subQuestion: SubQuestion, article: PageArticle): number {
  const terms = queryTerms(subQuestion)
  const head = coverage(terms, article.title)
  const body = coverage(terms, clip(article.text, 6_000))
  return Math.min(1, head * 0.5 + body)
}

export interface QuoteOptions {
  max?: number
  /** Prefer sentences that read like a finding, not navigation chrome. */
  minChars?: number
}

export function pickQuotes(text: string, terms: readonly string[], options: QuoteOptions = {}): string[] {
  const max = options.max ?? 3
  const min = options.minChars ?? 40
  const scored = sentences(text)
    .filter((sentence) => sentence.length >= min && sentence.length <= 320)
    .map((sentence) => ({ sentence, score: coverage(terms, sentence) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  const out: string[] = []
  for (const entry of scored) {
    if (out.length >= max) break
    if (out.some((existing) => existing.includes(entry.sentence) || entry.sentence.includes(existing))) continue
    out.push(entry.sentence)
  }
  return out
}

/** Claims are the checkable statements: prefer ones with numbers or names. */
export function pickClaims(text: string, terms: readonly string[], max = 4): string[] {
  const factual = /(\d|%"|%|because|leads?|shows?|found|report|study|increas|decreas)/i
  const scored = sentences(text)
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 300)
    .map((sentence) => ({
      sentence,
      score: coverage(terms, sentence) + (factual.test(sentence) ? 0.25 : 0),
    }))
    .filter((entry) => entry.score >= 0.3)
    .sort((a, b) => b.score - a.score)

  const out: string[] = []
  for (const entry of scored) {
    if (out.length >= max) break
    if (out.some((existing) => existing.includes(entry.sentence))) continue
    out.push(clip(entry.sentence, 300))
  }
  return out
}

const BARELY_A_SOURCE = /^(read more|continue|next|previous|share|subscribe|sign in|log in|menu|close)/i

/**
 * Credibility blends host reputation, byline/date presence and content
 * density (spec §7 `credibility_score`). Model judgement, when we have it,
 * nudges the heuristic rather than replacing it.
 */
export function credibilityOf(article: PageArticle, model: number | null): number {
  let score = hostReputation(article.url) * 0.55

  if (article.url.startsWith('https://')) score += 0.08
  if (article.author !== null && article.author.length > 1) score += 0.12
  if (article.publishDate !== null) score += 0.1

  const words = article.text.split(/\s+/).length
  if (words >= 800) score += 0.12
  else if (words >= 300) score += 0.07

  if (model !== null) score = score * 0.7 + model * 0.3
  return Math.min(0.98, Math.max(0.05, Math.round(score * 100) / 100))
}

export interface NoteInput {
  runId: string
  subQuestion: SubQuestion
  article: PageArticle
  scores: ModelScores | null
  relevance: number
}

export function buildNote(input: NoteInput): SourceNote {
  const { article, subQuestion, scores } = input
  const terms = queryTerms(subQuestion)
  const quotes = scores !== null && scores.quotes.length > 0 ? scores.quotes : pickQuotes(article.text, terms)
  const claims = scores !== null && scores.claims.length > 0 ? scores.claims : pickClaims(article.text, terms)
  const usable = claims.filter((claim) => !BARELY_A_SOURCE.test(claim.trim()))

  return {
    id: article.url,
    runId: input.runId,
    url: article.url,
    title: article.title === '' ? article.url : article.title,
    subQuestionId: subQuestion.id,
    author: article.author,
    publishDate: article.publishDate,
    text: clip(article.text, NOTE_TEXT_BUDGET),
    snippetQuotes: quotes.map((quote) => clip(quote, 320)),
    claims: (usable.length > 0 ? usable : claims).slice(0, 4).map((claim) => clip(claim, 300)),
    relevance: Math.round(input.relevance * 100) / 100,
    credibility: credibilityOf(article, scores?.credibility ?? null),
    summary: '',
  }
}

/** Fallback when the model produced nothing usable: keep a claim we can cite. */
export function ensureClaims(note: SourceNote): SourceNote {
  if (note.claims.length > 0) return note
  const fallback = note.snippetQuotes.length > 0 ? note.snippetQuotes[0]! : clip(note.title, 200)
  return { ...note, claims: [fallback] }
}
