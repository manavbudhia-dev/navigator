import { cleanUrl } from '@/research/search'
import { contentTokens } from '@/research/text'
import type { TabIndexEntry, TabInfo } from './types'

/**
 * Small pure helpers shared by every tab-manager module: URL identity,
 * host labelling, and the memory heuristic behind the "RAM saved" figure.
 */

const MB = 1024 * 1024

/**
 * Chrome does not expose per-tab memory, so the figure we show is an
 * estimate: a fixed renderer cost plus a cost per character of indexed text.
 * It is labelled as an estimate in the UI.
 */
export const BASE_TAB_BYTES = 46 * MB
export const BYTES_PER_INDEXED_CHAR = 18

export function estimateTabBytes(entry: TabIndexEntry | null): number {
  return BASE_TAB_BYTES + (entry === null ? 0 : entry.chars * BYTES_PER_INDEXED_CHAR)
}

export function sumBytes(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / MB
  if (mb < 10) return `${mb.toFixed(1)} MB`
  return `${Math.round(mb)} MB`
}

/** Two tabs of the same article must collapse to one key. */
export function canonicalUrl(url: string): string {
  const cleaned = cleanUrl(url)
  if (cleaned === '') return ''
  let parsed: URL
  try {
    parsed = new URL(cleaned)
  } catch {
    return cleaned
  }
  if (parsed.hostname.startsWith('www.')) parsed.hostname = parsed.hostname.slice(4)
  if (parsed.hostname.endsWith(':80') || parsed.hostname.endsWith(':443')) {
    parsed.hostname = parsed.hostname.replace(/:(80|443)$/, '')
  }
  parsed.port = ''
  let next = parsed.toString()
  if (next.endsWith('/index.html')) next = next.slice(0, -'index.html'.length)
  return next === '' ? cleaned : next
}

export function urlKeyOf(url: string): string {
  const canonical = canonicalUrl(url)
  return canonical === '' ? url : canonical
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export function pathSegments(url: string): string[] {
  try {
    const parsed = new URL(url)
    return parsed.pathname.split('/').filter((part) => part.length > 0).slice(0, 4)
  } catch {
    return []
  }
}

/** Chrome's internal pages are not ours to group, index, or discard. */
export function isProtectedScheme(url: string): boolean {
  return /^(chrome|chrome-extension|edge|about|devtools|view-source|brave):/.test(url) || url === ''
}

const BRANDS: Record<string, string> = {
  'youtube.com': 'YouTube',
  'mail.google.com': 'Gmail',
  'drive.google.com': 'Drive',
  'docs.google.com': 'Google Docs',
  'calendar.google.com': 'Google Calendar',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'stackoverflow.com': 'Stack Overflow',
  'reddit.com': 'Reddit',
  'news.ycombinator.com': 'Hacker News',
  'twitter.com': 'Twitter',
  'x.com': 'X',
  'linkedin.com': 'LinkedIn',
  'netflix.com': 'Netflix',
  'spotify.com': 'Spotify',
  'amazon.com': 'Amazon',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'zoom.us': 'Zoom',
  'wikipedia.org': 'Wikipedia',
}

/** Hosts that publish under a second-level suffix, so `bbc.co.uk` stays whole. */
const CCSLDS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/** The registrable site of a URL: `music.youtube.com` and `youtube.com` are one site. */
export function siteOf(url: string): string {
  const host = hostOf(url)
  if (host === '' || isProtectedScheme(url)) return ''
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const second = parts[parts.length - 2]!
  const last = parts[parts.length - 1]!
  const keep = CCSLDS.has(second) && last.length === 2 ? 3 : 2
  return parts.slice(-keep).join('.')
}

/** Host, with the brand name used when we know it. */
export function hostLabel(url: string): string {
  const site = siteOf(url)
  if (site === '') return 'New tab'
  for (const [suffix, brand] of Object.entries(BRANDS)) {
    if (site === suffix || site.endsWith(`.${suffix}`)) return brand
  }
  const stem = site.split('.')[0]!
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

export function tabLabel(tab: TabInfo): string {
  const title = tab.title.replace(/\s+/g, ' ').trim()
  if (title === '' || title === tab.url) return tab.url === '' ? 'Untitled' : tab.url
  return title.length > 90 ? `${title.slice(0, 89)}…` : title
}

/** Words a cluster/search pass compares: title, host and the first path parts. */
export function tabSignature(tab: TabInfo): string {
  return `${tab.title} ${hostOf(tab.url)} ${pathSegments(tab.url).join(' ')}`
}

export function termsOf(text: string): string[] {
  return contentTokens(text)
}

/** Newest tab wins a tie: the user is probably looking at it. */
export function tabOrder(a: TabInfo, b: TabInfo): number {
  if (a.windowId !== b.windowId) return a.windowId - b.windowId
  return a.index - b.index
}
