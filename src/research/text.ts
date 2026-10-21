/**
 * Shared text helpers for the research engine. Deliberately dumb and
 * deterministic: the cheap model is only asked for judgement the heuristics
 * cannot provide, which keeps token spend (and tests) under control.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'cannot', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'in', 'is', 'it', 'its',
  'more', 'most', 'not', 'of', 'on', 'or', 'should', 'so', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'this', 'to', 'was', 'were', 'what', 'when', 'which',
  'who', 'why', 'will', 'with', 'would', 'you', 'your',
])

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word.length > 1)
}

/** Tokens that carry meaning: lower-cased, de-pluralised, stop words removed. */
export function contentTokens(text: string): string[] {
  const out: string[] = []
  for (const word of tokens(text)) {
    if (STOP_WORDS.has(word)) continue
    const stem = word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
    // 'is' stems to 'i', 'are' to 'a' — drop them again after stemming.
    if (STOP_WORDS.has(stem) || stem.length < 2) continue
    out.push(stem)
  }
  return out
}

export function unique(input: readonly string[]): string[] {
  return [...new Set(input)]
}

/** Share of `terms` present in `text`, 0..1. Term set empty → 0. */
export function coverage(terms: readonly string[], text: string): number {
  if (terms.length === 0) return 0
  const haystack = new Set(contentTokens(text))
  let hits = 0
  for (const term of unique(terms)) {
    if (haystack.has(term)) hits += 1
  }
  return hits / unique(terms).length
}

/** Jaccard similarity of two token sets, 0..1. */
export function similarity(a: string, b: string): number {
  const left = new Set(contentTokens(a))
  const right = new Set(contentTokens(b))
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) {
    if (right.has(word)) shared += 1
  }
  return shared / (left.size + right.size - shared)
}

/** Sentence split that survives abbreviations poorly but is cheap and stable. */
export function sentences(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/^[-*>#\s]+/, '').trim()
    if (line === '') continue
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    for (const part of parts) {
      const sentence = part.trim()
      if (sentence.length >= 4) out.push(sentence)
    }
  }
  return out
}

const NEGATIONS = /\b(not|no|never|cannot|can't|won't|without|fail|fails|failed|failing|less|lower|worse|decline|declined|denies|denied|avoid|hardly|unlikely|rarely)\b/i

/**
 * Crude polarity used to spot contradictions before spending model tokens:
 * two claims about the same topic where one negates are worth a closer look.
 */
export function polarity(text: string): -1 | 0 | 1 {
  const hits = text.match(new RegExp(NEGATIONS.source, 'gi'))
  if (hits === null) return 0
  return hits.length % 2 === 1 ? -1 : 1
}

/** Collapse whitespace and clip to a length that is safe to quote. */
export function clip(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= maxChars) return flat
  const cut = flat.slice(0, maxChars)
  const space = cut.lastIndexOf(' ')
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).trim()}…`
}
