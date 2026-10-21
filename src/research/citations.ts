import { contentTokens, coverage, unique } from './text'
import { orderSources } from './synthesize'
import type { Citation, SourceNote } from './types'

/**
 * Sentence → source mapping for the source panel hover (spec §7: "every
 * sentence hover shows which source it came from"). The engine cites with
 * [n] markers, but models drop or shift them, so each sentence is also
 * matched back to the corpus by content.
 */

export interface SentencePart {
  text: string
  /** Citation numbers backing this sentence, most likely first. */
  sources: number[]
  /** True when the sentence carried its own [n] markers. */
  explicit: boolean
}

export interface AnswerLine {
  kind: 'heading' | 'bullet' | 'text'
  parts: SentencePart[]
}

const CITATION = /\[(\d{1,3})\]/

export function explicitNumbers(text: string): number[] {
  const out: number[] = []
  for (const match of text.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(match[1])
    if (!out.includes(n)) out.push(n)
  }
  return out
}

export function stripCitations(text: string): string {
  return text.replace(/\s*\[\d{1,3}\]/g, '').trim()
}

/** Sources whose own claims/quotes overlap this sentence, best first. */
export function sourcesForSentence(
  sentence: string,
  notes: readonly SourceNote[],
  numberById: ReadonlyMap<string, number>,
  limit = 3,
): number[] {
  const terms = unique(contentTokens(sentence)).slice(0, 14)
  if (terms.length < 3) return []
  const scored = notes
    .map((note) => {
      const body = `${note.title} ${note.claims.join('. ')} ${note.snippetQuotes.join('. ')} ${note.summary}`
      return { id: note.id, score: coverage(terms, body) }
    })
    .filter((entry) => entry.score >= 0.34)
    .sort((a, b) => b.score - a.score)

  const out: number[] = []
  for (const entry of scored) {
    const n = numberById.get(entry.id)
    if (n === undefined || out.includes(n)) continue
    out.push(n)
    if (out.length >= limit) break
  }
  return out
}

function splitSentences(line: string): string[] {
  const parts = line.split(/(?<=[.!?:])\s+/).filter((part) => part.trim() !== '')
  return parts.length > 0 ? parts : line.trim() === '' ? [] : [line.trim()]
}

export function layoutAnswer(answer: string, notes: readonly SourceNote[]): AnswerLine[] {
  const numberById = new Map(citationNumbers(notes).map((citation) => [citation.sourceId, citation.n]))
  const lines: AnswerLine[] = []

  for (const raw of answer.split('\n')) {
    const line = raw.trim()
    if (line === '') continue

    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading !== null) {
      lines.push({ kind: 'heading', parts: [{ text: heading[1]!, sources: [], explicit: false }] })
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line)
    const kind = bullet !== null ? 'bullet' : 'text'
    const body = bullet?.[1] ?? line
    const parts: SentencePart[] = []
    for (const sentence of splitSentences(body)) {
      const explicit = explicitNumbers(sentence)
      const matched = sourcesForSentence(sentence, notes, numberById)
      const sources = explicit.length > 0 ? explicit : matched
      const text = stripCitations(sentence)
      if (text === '') continue
      parts.push({ text, sources, explicit: explicit.length > 0 })
    }
    if (parts.length > 0) lines.push({ kind, parts })
  }

  return lines
}

/** Notes are numbered in relevance order — the same order the report lists. */
export function citationNumbers(notes: readonly SourceNote[]): Citation[] {
  return orderSources(notes).map((note, i) => ({ n: i + 1, sourceId: note.id, url: note.url, title: note.title }))
}

export function citationPresent(text: string): boolean {
  return CITATION.test(text)
}
