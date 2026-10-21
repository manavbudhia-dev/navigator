/**
 * Long-term memory recall (spec §4). Pure so the ranking is testable without
 * IndexedDB — `entries.ts` is the thin Dexie layer over it.
 *
 * Recall is keyword scoring, not embeddings: it runs in the service worker
 * with no model call and no network, and the reason a note matched is
 * something the user can be told.
 */

export interface MemoryEntry {
  id: number
  at: number
  text: string
  tags: string[]
  url: string
}

export interface NewMemory {
  text: string
  tags?: string[]
  url?: string
}

/** Past this the oldest notes are dropped; memory must not grow without limit. */
export const MAX_MEMORIES = 500

/** A note longer than this was not a note, it was an essay. */
export const MAX_MEMORY_CHARS = 600

const WORDS = /[\p{L}\p{N}][\p{L}\p{N}._-]*/gu

/** Words so common in a query that matching on them says nothing. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'which', 'who', 'how',
  'did', 'does', 'have', 'has', 'was', 'were', 'are', 'you', 'your', 'about', 'from', 'into',
  'them', 'they', 'its', 'any', 'all', 'get', 'got', 'tell', 'find', 'show', 'give',
  // Two-letter filler. Short real words stay: cv, id, url, qa, nda.
  'is', 'it', 'of', 'to', 'in', 'on', 'at', 'an', 'as', 'be', 'by', 'do', 'he', 'we', 'so',
  'or', 'no', 'if', 'me', 'my', 'us', 'am', 'i', 'a',
])

export function normalizeNote(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Meaningful lowercase words of a query or a note, de-duplicated. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const match of normalizeNote(text).matchAll(WORDS)) {
    const word = match[0]!
    if (word.length < 2 || STOPWORDS.has(word)) continue
    if (!out.includes(word)) out.push(word)
  }
  return out
}

/**
 * How well a query fits one note. Tags count most (the agent chose them),
 * then the sentence, then the page it came from. Recency only breaks ties
 * between notes that match.
 */
export function scoreMemory(query: string, entry: MemoryEntry, at = Date.now()): number {
  const terms = tokenize(query)
  if (terms.length === 0) return 0
  const text = normalizeNote(entry.text)
  const tags = entry.tags.map((tag) => normalizeNote(tag))
  const url = normalizeNote(entry.url)
  let hits = 0
  let score = 0
  for (const term of terms) {
    const inTag = tags.some((tag) => tag === term || tag.includes(term) || term.includes(tag))
    const inText = text.includes(term)
    const inUrl = url !== '' && url.includes(term)
    if (!inTag && !inText && !inUrl) continue
    hits += 1
    score += (inTag ? 3 : 0) + (inText ? 2 : 0) + (inUrl ? 1 : 0)
  }
  if (hits === 0) return 0
  // Matching every term the user asked about beats matching one of them.
  const coverage = hits / terms.length
  const days = Math.max(0, (at - entry.at) / 86_400_000)
  return score * coverage + 1 / (1 + days / 30)
}

/** Best matches first; an empty query means "the most recent notes". */
export function rankMemories(
  query: string,
  entries: readonly MemoryEntry[],
  limit = 8,
  at = Date.now(),
): MemoryEntry[] {
  if (query.trim() === '') {
    return [...entries].sort((a, b) => b.at - a.at).slice(0, limit)
  }
  return entries
    .map((entry) => ({ entry, score: scoreMemory(query, entry, at) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.at - a.entry.at)
    .slice(0, limit)
    .map((scored) => scored.entry)
}

/** Tags as they are stored: lower-case, short, no duplicates, at most six. */
export function cleanTags(tags: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const raw of tags ?? []) {
    const tag = normalizeNote(raw).slice(0, 24)
    if (tag !== '' && !out.includes(tag)) out.push(tag)
    if (out.length === 6) break
  }
  return out
}

/** What the panel shows next to each note. */
export function whenLabel(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(at).toISOString().slice(0, 10)
}
