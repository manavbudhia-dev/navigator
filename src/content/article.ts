import { extractMarkdown } from './perception/extract'

import { isSafeHref } from '@/lib/linkScheme'
import type { ArticlePayload } from '@/research/types'

/**
 * Article reader for the research gather pass (spec §7): main content as
 * Markdown plus the byline and date the note object needs, and the anchor
 * list a search-results page is turned into.
 */

const MAX_TEXT = 40_000

function meta(doc: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = doc.querySelector(selector)
    if (!el) continue
    const value = el.getAttribute('content') ?? el.getAttribute('datetime') ?? el.textContent ?? ''
    const trimmed = value.trim()
    if (trimmed !== '') return trimmed.slice(0, 200)
  }
  return null
}

/** JSON-LD is the only place many news sites put the byline. */
function fromJsonLd(doc: Document, key: 'author' | 'datePublished'): string | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    const raw = script.textContent ?? ''
    if (raw.length > 60_000) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const found = searchJson(parsed, key)
    if (found !== null) return found
  }
  return null
}

function searchJson(value: unknown, key: 'author' | 'datePublished'): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchJson(item, key)
      if (found !== null) return found
    }
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const direct = record[key]
  if (typeof direct === 'string' && direct.trim() !== '') return direct.slice(0, 200)
  if (typeof direct === 'object' && direct !== null) {
    const name = (direct as Record<string, unknown>)['name']
    if (typeof name === 'string' && name.trim() !== '') return name.slice(0, 200)
  }
  for (const nested of Object.values(record)) {
    const found = searchJson(nested, key)
    if (found !== null) return found
  }
  return null
}

export function readAuthor(doc: Document): string | null {
  return (
    meta(doc, [
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="byl"]',
      '[rel="author"]',
      '.author',
      '[itemprop="author"]',
    ]) ?? fromJsonLd(doc, 'author')
  )
}

export function readPublishDate(doc: Document): string | null {
  return (
    meta(doc, [
      'meta[property="article:published_time"]',
      'meta[name="publication_date"]',
      'time[datetime]',
      '[itemprop="datePublished"]',
      'meta[name="date"]',
    ]) ?? fromJsonLd(doc, 'datePublished')
  )
}

/** ISO date when we can parse one, otherwise the raw string. */
export function normalizeDate(raw: string | null): string | null {
  if (raw === null) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 40)
  return parsed.toISOString().slice(0, 10)
}

export function readArticle(doc: Document): Omit<ArticlePayload, 'links'> {
  const text = extractMarkdown(doc).slice(0, MAX_TEXT)
  return {
    url: doc.baseURI || doc.URL,
    title: (doc.querySelector('h1')?.textContent ?? doc.title).trim().slice(0, 200),
    text,
    author: readAuthor(doc),
    publishDate: normalizeDate(readPublishDate(doc)),
  }
}

function snippetFor(anchor: HTMLAnchorElement): string {
  const container = anchor.closest('div, li, article')
  if (!container) return ''
  const marked = container.querySelector('.result__snippet, .result-snippet, [data-result-snippet]')
  const text = marked?.textContent ?? ''
  const fallback = container.textContent ?? ''
  return (text !== '' ? text : fallback.replace(anchor.textContent ?? '', '')).replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** Raw anchors, unfiltered — `rankHits` in the engine does the judgement. */
export function collectLinks(doc: Document): ArticlePayload['links'] {
  const out: ArticlePayload['links'] = []
  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const title = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (title === '') continue
    let url: string
    try {
      url = new URL(anchor.href).toString()
    } catch {
      continue
    }
    // `anchor.href` is resolved, not sanitised: a page can still point it at
    // javascript:, data: or file:, and the research tab renders these as links.
    if (!isSafeHref(url, doc.baseURI)) continue
    out.push({ url, title, snippet: snippetFor(anchor) })
    if (out.length >= 120) break
  }
  return out
}

export function readArticleWithLinks(doc: Document): ArticlePayload {
  return { ...readArticle(doc), links: collectLinks(doc) }
}
