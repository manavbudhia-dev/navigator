import { contentTokens } from '@/research/text'
import { hostOf, hostLabel, pathSegments, siteOf, tabLabel } from './model'
import type { TabClusterLite, TabInfo } from './types'

/**
 * Auto-grouping (spec §8): cluster tabs by similarity of title + domain, name
 * the cluster, assign a colour.
 *
 * The similarity space is a small local embedding: each tab becomes a
 * term-weighted vector built from its host (weight 3), path (2) and title (1),
 * compared with cosine similarity. No network, no model tokens, deterministic
 * in tests — and swappable for a provider embedding later, because everything
 * above this file only sees `Vector` and `cosine`.
 */

export type Vector = Map<string, number>

const HOST_WEIGHT = 3
const PATH_WEIGHT = 2
const TITLE_WEIGHT = 1

/** Similarity needed to join an existing cluster. */
export const MIN_SIMILARITY = 0.34
/** A cluster smaller than this stays ungrouped — grouping singletons is noise. */
export const MIN_CLUSTER_SIZE = 2

/**
 * Registry suffixes carry no meaning: they are shared by most of the web and
 * would let two unrelated tabs cluster because both sites end in `.com`.
 */
const HOST_NOISE = new Set([
  'com', 'org', 'net', 'io', 'co', 'uk', 'us', 'de', 'fr', 'jp', 'cn', 'ru', 'au', 'ca', 'nl',
  'se', 'no', 'es', 'it', 'pl', 'br', 'in', 'xyz', 'app', 'dev', 'ai', 'gg', 'tv', 'me', 'www',
])

function add(target: Vector, terms: readonly string[], weight: number): void {
  for (const term of terms) {
    if (HOST_NOISE.has(term)) continue
    target.set(term, (target.get(term) ?? 0) + weight)
  }
}

function normalise(vector: Vector): Vector {
  let sum = 0
  for (const value of vector.values()) sum += value * value
  const length = Math.sqrt(sum)
  if (length === 0) return vector
  const out: Vector = new Map()
  for (const [term, value] of vector) out.set(term, value / length)
  return out
}

export function tabVector(tab: TabInfo): Vector {
  const raw: Vector = new Map()
  add(raw, contentTokens(hostOf(tab.url)), HOST_WEIGHT)
  add(raw, contentTokens(pathSegments(tab.url).join(' ')), PATH_WEIGHT)
  add(raw, contentTokens(tab.title), TITLE_WEIGHT)
  return normalise(raw)
}

export function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [term, value] of small) {
    const other = large.get(term)
    if (other !== undefined) dot += value * other
  }
  return dot
}

function centroidOf(members: readonly Vector[]): Vector {
  const sum: Vector = new Map()
  for (const member of members) {
    for (const [term, value] of member) sum.set(term, (sum.get(term) ?? 0) + value)
  }
  for (const [term, value] of sum) sum.set(term, value / members.length)
  return normalise(sum)
}

/** Terms that appear in more than one member — the cluster's identity. */
function sharedTerms(tabs: readonly TabInfo[]): string[] {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    for (const term of new Set(contentTokens(tabSignatureOf(tab)))) {
      if (HOST_NOISE.has(term)) continue
      counts.set(term, (counts.get(term) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term)
}

function tabSignatureOf(tab: TabInfo): string {
  return `${tab.title} ${hostOf(tab.url)} ${pathSegments(tab.url).join(' ')}`
}

export interface ClusterOptions {
  minSimilarity?: number
  minSize?: number
}

interface Draft {
  tabs: TabInfo[]
  vectors: Vector[]
  centroid: Vector
}

/**
 * Greedy agglomerative pass. Chrome tab groups live inside one window, so the
 * clustering is window-scoped: a Reddit tab in window 1 never joins a Reddit
 * tab in window 2.
 */
export function clusterTabs(tabs: readonly TabInfo[], options: ClusterOptions = {}): TabClusterLite[] {
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY
  const minSize = options.minSize ?? MIN_CLUSTER_SIZE

  const byWindow = new Map<number, TabInfo[]>()
  for (const tab of tabs) {
    const list = byWindow.get(tab.windowId)
    if (list) list.push(tab)
    else byWindow.set(tab.windowId, [tab])
  }

  const out: TabClusterLite[] = []
  for (const [windowId, windowTabs] of [...byWindow.entries()].sort((a, b) => a[0] - b[0])) {
    const drafts: Draft[] = []
    for (const tab of [...windowTabs].sort((a, b) => a.index - b.index)) {
      const vector = tabVector(tab)
      let best: { draft: Draft; score: number } | null = null
      for (const draft of drafts) {
        const score = cosine(vector, draft.centroid)
        if (score >= minSimilarity && (best === null || score > best.score)) best = { draft, score }
      }
      if (best === null) {
        drafts.push({ tabs: [tab], vectors: [vector], centroid: vector })
      } else {
        best.draft.tabs.push(tab)
        best.draft.vectors.push(vector)
        best.draft.centroid = centroidOf(best.draft.vectors)
      }
    }

    for (const draft of drafts) {
      if (draft.tabs.length < minSize) continue
      out.push({
        windowId,
        tabs: draft.tabs,
        terms: sharedTerms(draft.tabs),
        host: mostCommonHost(draft.tabs),
      })
    }
  }
  return out
}

function mostCommonHost(tabs: readonly TabInfo[]): string {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    const host = hostOf(tab.url)
    if (host === '') continue
    counts.set(host, (counts.get(host) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return ranked.length > 0 ? ranked[0]![0] : ''
}

/**
 * Deterministic group name. If every tab shares a host, the brand is the name;
 * otherwise the most common terms are. The LLM pass in `prompts/tabs.ts`
 * replaces this only when it returns something usable.
 */
export function deterministicName(cluster: TabClusterLite): string {
  const sites = new Set(cluster.tabs.map((tab) => siteOf(tab.url)).filter((site) => site !== ''))
  if (sites.size === 1) return hostLabel(`https://${[...sites][0] ?? ''}`)
  const hostTerms = new Set(contentTokens(cluster.host))
  const top = cluster.terms.filter((term) => term.length > 2 && !hostTerms.has(term)).slice(0, 2)
  if (top.length === 0) return 'Grouped tabs'
  return top
    .map((term) => term.charAt(0).toUpperCase() + term.slice(1))
    .join(' ')
    .slice(0, 24)
}

/** Human-readable summary of what one cluster contains. */
export function describeCluster(cluster: TabClusterLite): string {
  return cluster.tabs.map((tab) => `"${tabLabel(tab)}" (${hostOf(tab.url) || 'no host'})`).join(', ')
}
