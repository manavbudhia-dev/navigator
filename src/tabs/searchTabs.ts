import { clip, contentTokens, coverage } from '@/research/text'
import { hostOf, pathSegments, urlKeyOf } from './model'
import type { TabIndexEntry, TabInfo, TabSearchResult } from './types'

/**
 * Tab search (spec §8): semantic search across open tabs *and* the page-text
 * index. Titles and URLs always score; content only counts once a page has
 * been indexed, and the result says which of the two matched so the UI never
 * implies we read a page we did not read.
 */

const CONTENT_WINDOW = 6_000
const META_WEIGHT = 0.6
const CONTENT_WEIGHT = 0.4
const PHRASE_BONUS_META = 0.25
const PHRASE_BONUS_CONTENT = 0.15

export interface TabSearchOptions {
  limit?: number
  /** Tabs whose URL is not in this set are skipped (used by scoped searches). */
  onlyIds?: Set<number>
}

/** A window of `text` centred on the first term hit. */
export function snippetFor(text: string, terms: readonly string[], maxChars = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  const lower = flat.toLowerCase()
  let at = -1
  let hit = ''
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found >= 0 && (at === -1 || found < at)) {
      at = found
      hit = term
    }
  }
  if (at === -1) return clip(flat, maxChars)
  const start = Math.max(0, at - Math.floor((maxChars - hit.length) / 2))
  const end = Math.min(flat.length, start + maxChars)
  const window = flat.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${window}${end < flat.length ? '…' : ''}`
}

export function searchTabs(
  tabs: readonly TabInfo[],
  index: Map<string, TabIndexEntry>,
  query: string,
  options: TabSearchOptions = {},
): TabSearchResult[] {
  const terms = contentTokens(query)
  if (terms.length === 0) return []
  const phrase = query.trim().toLowerCase()
  const limit = options.limit ?? 8

  const results: TabSearchResult[] = []
  for (const tab of tabs) {
    if (options.onlyIds !== undefined && !options.onlyIds.has(tab.id)) continue
    const meta = `${tab.title} ${hostOf(tab.url)} ${pathSegments(tab.url).join(' ')}`
    const metaScore = coverage(terms, meta)
    const entry = index.get(urlKeyOf(tab.url))
    const body = entry === undefined ? '' : clip(entry.text.slice(0, CONTENT_WINDOW), CONTENT_WINDOW)
    const contentScore = body === '' ? 0 : coverage(terms, body)

    const inMeta = phrase.length > 3 && meta.toLowerCase().includes(phrase)
    const inBody = phrase.length > 3 && body.toLowerCase().includes(phrase)

    let score = metaScore * META_WEIGHT + contentScore * CONTENT_WEIGHT
    if (inMeta) score += PHRASE_BONUS_META
    if (inBody) score += PHRASE_BONUS_CONTENT
    if (score <= 0) continue

    const fromContent = contentScore > 0 || inBody
    const fromMeta = metaScore > 0 || inMeta
    const where: TabSearchResult['where'] =
      fromContent && fromMeta ? 'both' : fromContent ? 'content' : titleHit(tab, terms) ? 'title' : 'url'

    results.push({
      tab,
      score: Math.min(1, score),
      where,
      snippet: fromContent ? snippetFor(body, terms) : snippetFor(`${tab.title} ${tab.url}`, terms),
    })
  }

  return results
    .sort((a, b) => b.score - a.score || a.tab.windowId - b.tab.windowId || a.tab.index - b.tab.index)
    .slice(0, limit)
}

function titleHit(tab: TabInfo, terms: readonly string[]): boolean {
  const title = new Set(contentTokens(tab.title))
  return terms.some((term) => title.has(term))
}
