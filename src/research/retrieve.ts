import { sanitizeUntrusted } from '@/prompts/sanitize'
import { clip, contentTokens, unique } from './text'
import type { SourceNote } from './types'

/**
 * Retrieval over the gathered corpus (spec §7: follow-up chat on top of the
 * collected notes). Small budget, cheap ranking, no embeddings — the corpus is
 * a dozen pages, not a library.
 */

/** Per-note context budget so 20 sources never blow the prompt. */
export const NOTE_CONTEXT_CHARS = 1_200
export const CONTEXT_NOTES = 6

export function termFrequency(terms: readonly string[], text: string): number {
  const words = contentTokens(text)
  if (words.length === 0) return 0
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
  let score = 0
  for (const term of unique(terms)) score += counts.get(term) ?? 0
  // Length-normalised so a long page does not win on volume alone.
  return score / Math.sqrt(words.length)
}

export function rankNotes(
  notes: readonly SourceNote[],
  query: string,
  limit = CONTEXT_NOTES,
): { note: SourceNote; score: number }[] {
  const terms = contentTokens(query)
  return notes
    .map((note) => ({
      note,
      score:
        termFrequency(terms, note.claims.join('. ')) * 1.5 +
        termFrequency(terms, note.summary) * 1.2 +
        termFrequency(terms, note.text),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.note.credibility - a.note.credibility)
    .slice(0, limit)
}

/** Numbered context block for the follow-up prompt, untrusted content fenced. */
export function buildFollowupContext(
  notes: readonly SourceNote[],
  numberById: ReadonlyMap<string, number>,
  query: string,
): { context: string; used: SourceNote[] } {
  const ranked = rankNotes(notes, query)
  const blocks = ranked.map(({ note }) => {
    const n = numberById.get(note.id) ?? '?'
    const body = [note.summary, ...note.claims, ...note.snippetQuotes].filter((line) => line !== '').join('\n')
    return `[${n}] ${note.title} — ${note.url}\n${sanitizeUntrusted(clip(body || note.text, NOTE_CONTEXT_CHARS)).text}`
  })
  return { context: blocks.join('\n\n'), used: ranked.map((entry) => entry.note) }
}
