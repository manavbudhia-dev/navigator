import { clip, coverage, contentTokens } from './text'
import type { SearchHit } from './types'

/**
 * Search-result hygiene (spec §7 GATHER). The engine ranks raw hits the
 * browser scraped off a results page — the scraping itself lives in the
 * content script so this stays pure and testable.
 */

const TRACKING_PARAMS = /^utm_|^(fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref|src|igshid|si)$/i

const NOISE_HOSTS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'tiktok.com',
]

const NOISE_PATHS = [
  '/login',
  '/signin',
  '/signup',
  '/register',
  '/cart',
  '/checkout',
  '/privacy',
  '/terms',
  '/cookie',
  '/unsubscribe',
  '/advertis',
  '/redirect',
  '/showcase',
]

/** Drop fragments and tracking params so the same article is not read twice. */
export function cleanUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  url.hash = ''
  const kept: [string, string][] = []
  for (const [key, value] of url.searchParams) {
    if (!TRACKING_PARAMS.test(key)) kept.push([key, value])
  }
  url.search = new URLSearchParams(kept).toString()
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1)
  return url.toString()
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** Social chrome, login walls and the search engine's own pages. */
export function isNoiseUrl(url: string): boolean {
  const host = hostOf(url)
  if (host === '') return true
  if (NOISE_HOSTS.some((noise) => host === noise || host.endsWith(`.${noise}`))) return true

  let path = '/'
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return true
  }
  if (NOISE_PATHS.some((noise) => path.includes(noise))) return true
  return /\.(jpg|jpeg|png|gif|svg|webp|mp4|mp3|ico|css|js|json|xml|gz|zip|rar|exe|dmg|apk)$/i.test(path)
}

/** Results pages link to themselves and to redirects — never follow those. */
export function isSelfUrl(url: string, baseUrl: string): boolean {
  const a = hostOf(url)
  const b = hostOf(baseUrl)
  if (a === '' || b === '') return false
  return a === b || a.endsWith(`.${b}`)
}

function titleOf(raw: string): string {
  return clip(raw.replace(/\s+/g, ' '), 160)
}

/**
 * Rank by how many query terms appear in title + snippet, then keep the
 * variety of the results page: at most `perDomain` pages per host.
 */
export function rankHits(
  raw: readonly { url: string; title: string; snippet?: string }[],
  query: string,
  limit: number,
  options: { baseUrl?: string; perDomain?: number } = {},
): SearchHit[] {
  const terms = contentTokens(query)
  const baseUrl = options.baseUrl ?? ''
  const perDomain = options.perDomain ?? 2
  const seen = new Set<string>()
  const domains = new Map<string, number>()

  interface Candidate {
    url: string
    title: string
    snippet: string
    score: number
  }

  const candidates: Candidate[] = []
  for (const hit of raw) {
    const url = cleanUrl(hit.url)
    if (url === '' || seen.has(url)) continue
    if (isNoiseUrl(url)) continue
    if (baseUrl !== '' && isSelfUrl(url, baseUrl)) continue
    const title = titleOf(hit.title)
    const snippet = clip(hit.snippet ?? '', 400)
    if (title === '') continue
    seen.add(url)
    candidates.push({ url, title, snippet, score: coverage(terms, `${title} ${snippet}`) })
  }

  candidates.sort((a, b) => (b.score === a.score ? a.url.localeCompare(b.url) : b.score - a.score))

  const out: SearchHit[] = []
  for (const candidate of candidates) {
    if (out.length >= limit) break
    const host = hostOf(candidate.url)
    const used = domains.get(host) ?? 0
    if (used >= perDomain) continue
    domains.set(host, used + 1)
    out.push({ url: candidate.url, title: candidate.title, snippet: candidate.snippet })
  }
  return out
}

/** Heuristic host reputation used by the credibility score (spec §7). */
const TRUSTED_HOSTS = [
  'wikipedia.org',
  'britannica.com',
  'nature.com',
  'sciencedirect.com',
  'arxiv.org',
  'acm.org',
  'ieee.org',
  'nih.gov',
  'who.int',
  'un.org',
  'oecd.org',
  'worldbank.org',
  'imf.org',
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'economist.com',
  'ft.com',
  'ieee-spectrum.org',
]

export function hostReputation(url: string): number {
  const host = hostOf(url)
  if (host === '') return 0
  if (/\.(gov|edu|int)(\.|$)/.test(host)) return 0.85
  if (TRUSTED_HOSTS.some((trusted) => host === trusted || host.endsWith(`.${trusted}`))) return 0.8
  if (host.endsWith('.com') || host.endsWith('.org') || host.endsWith('.net')) return 0.45
  return 0.35
}
