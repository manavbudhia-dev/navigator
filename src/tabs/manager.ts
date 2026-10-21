import { clip, contentTokens, coverage } from '@/research/text'
import { buildGroupNameMessages, buildIntentMessages, parseGroupNames, parseIntentReply } from '@/prompts/tabs'
import { clusterTabs, deterministicName } from './cluster'
import { describeIntent, matchLabel, parseCommand } from './commands'
import { findDuplicates } from './dupes'
import { heavyCandidates } from './memory'
import { hostLabel, hostOf, isProtectedScheme, siteOf, sumBytes, tabLabel, urlKeyOf } from './model'
import { searchTabs } from './searchTabs'
import { staleTabs } from './stale'
import { UndoBuffer, type ClosedSnapshot } from './undo'
import type {
  SavedSession,
  StaleTab,
  TabClusterLite,
  TabComplete,
  TabGroupColor,
  TabInfo,
  TabIntent,
  TabLine,
  TabLineKind,
  TabMatch,
  TabMemory,
  TabReport,
  TabSearchResult,
  TabSurface,
  UndoState,
} from './types'
import { clampDays, clampFreeTabs, TAB_GROUP_COLORS } from './types'

/**
 * Tab manager (spec §8). Orchestrates the pure modules against a `TabSurface`
 * and a `TabMemory` and returns one `TabReport` per operation — the same
 * report the side panel renders and the agent's tool result text is built
 * from, so neither UI nor model can disagree about what actually happened.
 */

/** Tabs the caller refuses to lose: the agent's own working tab, pinned tabs. */
export interface TabGuard {
  keepIds: number[]
}

export interface TabManagerOptions {
  surface: TabSurface
  memory: TabMemory
  undo?: UndoBuffer
  complete?: TabComplete
  now?: () => number
  newId?: () => string
  /** Pages one index pass reads — a 200-tab window should not hang the panel. */
  indexLimit?: number
}

export interface RunOptions {
  guard?: TabGuard
  signal?: AbortSignal
}

const MAX_INDEX_PER_PASS = 40

class Draft {
  lines: TabLine[] = []
  found: TabSearchResult[] = []
  stale: StaleTab[] = []
  sessions: SavedSession[] = []
  closed = 0
  grouped = 0
  freedBytes = 0
  promptTokens = 0
  completionTokens = 0
  error: string | null = null

  add(kind: TabLineKind, text: string): void {
    this.lines.push({ kind, text: clip(text, 220) })
  }
}

export class TabManager {
  private readonly surface: TabSurface
  private readonly memory: TabMemory
  private readonly undo: UndoBuffer
  private readonly complete: TabComplete | undefined
  private readonly now: () => number
  private readonly newId: () => string
  private readonly indexLimit: number

  constructor(options: TabManagerOptions) {
    this.surface = options.surface
    this.memory = options.memory
    this.undo = options.undo ?? new UndoBuffer()
    this.complete = options.complete
    this.now = options.now ?? (() => Date.now())
    this.newId = options.newId ?? (() => `t${Math.random().toString(36).slice(2, 10)}`)
    this.indexLimit = options.indexLimit ?? MAX_INDEX_PER_PASS
  }

  undoState(): UndoState | null {
    return this.undo.state()
  }

  secondsUntilUndo(): number {
    return this.undo.secondsLeft(this.now())
  }

  /** Turn one sentence into an intent, then run it. */
  async runCommand(text: string, options: RunOptions = {}): Promise<TabReport> {
    const tabs = await this.surface.list()
    const heuristic = parseCommand(text, tabs)
    if (heuristic !== null) return this.run(heuristic, { source: text, ...options })
    const asked = await this.classifyWithModel(text, tabs, options.signal)
    if (asked === null) {
      const draft = new Draft()
      draft.error =
        'I could not tell what to do with that. Try: "close all YouTube tabs", "group my tabs", "find the pricing page", "save this session for tomorrow".'
      draft.add('error', draft.error)
      return this.finish({ kind: 'list', match: { scope: 'all' } }, draft, text, tabs)
    }
    return this.run(asked, { source: text, ...options })
  }

  private async classifyWithModel(text: string, tabs: TabInfo[], signal?: AbortSignal): Promise<TabIntent | null> {
    if (this.complete === undefined) return null
    try {
      const result = await this.complete(buildIntentMessages(text, tabs), 'small', signal)
      return parseIntentReply(result.message.content ?? '')
    } catch (error) {
      if (signal?.aborted === true) throw error
      return null
    }
  }

  async run(intent: TabIntent, options: RunOptions & { source?: string } = {}): Promise<TabReport> {
    const before = await this.surface.list()
    // Last-seen bookkeeping is written only by the tab listeners: touching every
    // open tab here would make the stale sweeper blind, because listing a tab
    // is not the same as using it.

    const draft = new Draft()
    const source = options.source ?? describeIntent(intent)
    const guard = options.guard ?? { keepIds: [] }
    const signal = options.signal

    try {
      switch (intent.kind) {
        case 'list':
          await this.list(draft, intent.match, before)
          break
        case 'close':
          await this.close(draft, intent.match, before, guard)
          break
        case 'group':
          await this.group(draft, intent.match, before, guard, signal)
          break
        case 'ungroup':
          await this.ungroup(draft, intent.match, before, guard)
          break
        case 'merge':
          await this.merge(draft, before, guard)
          break
        case 'find':
          await this.find(draft, intent.query, before)
          break
        case 'switch':
          await this.switchTo(draft, intent.query, before)
          break
        case 'free':
          await this.free(draft, intent.match, before, guard, clampFreeTabs(intent.maxTabs))
          break
        case 'stale':
          await this.stale(draft, clampDays(intent.days), before)
          break
        case 'index':
          await this.index(draft, before)
          break
        case 'save':
          await this.save(draft, intent.name, intent.note, intent.tags, before)
          break
        case 'restore':
          await this.restore(draft, intent.name, before)
          break
        case 'sessions':
          draft.sessions = await this.memory.listSessions()
          draft.add('session', `${draft.sessions.length} saved session${draft.sessions.length === 1 ? '' : 's'}.`)
          break
        case 'undo':
          await this.undoClose(draft)
          break
      }
    } catch (error) {
      if (signal?.aborted === true) throw error
      draft.error = error instanceof Error ? error.message : String(error)
      draft.add('error', draft.error)
    }

    return this.finish(intent, draft, source, before)
  }

  private async finish(intent: TabIntent, draft: Draft, source: string, before: TabInfo[]): Promise<TabReport> {
    const after = await this.surface.list().catch(() => before)
    const summary =
      draft.error !== null
        ? draft.error
        : draft.lines.length === 0
          ? `Nothing to do for "${source}".`
          : `${describeIntent(intent)} — ${summarise(draft)}`
    return {
      ok: draft.error === null,
      intent: intent.kind,
      summary,
      lines: draft.lines,
      tabs: after,
      found: draft.found,
      stale: draft.stale,
      sessions: draft.sessions,
      closed: draft.closed,
      grouped: draft.grouped,
      freedBytes: draft.freedBytes,
      undo: this.undo.state(),
      error: draft.error,
      promptTokens: draft.promptTokens,
      completionTokens: draft.completionTokens,
    }
  }

  // ---------------------------------------------------------------- selection

  private async idsFor(match: TabMatch, tabs: readonly TabInfo[], indexKeys: string[]): Promise<Set<number>> {
    const keep = new Set<number>()
    switch (match.scope) {
      case 'all':
        for (const tab of tabs) keep.add(tab.id)
        break
      case 'others':
        for (const tab of tabs) if (!tab.active) keep.add(tab.id)
        break
      case 'host': {
        const host = match.host.toLowerCase().replace(/^www\./, '')
        for (const tab of tabs) {
          const tabHost = hostOf(tab.url)
          if (tabHost === host || tabHost.endsWith(`.${host}`) || host.endsWith(`.${tabHost}`)) keep.add(tab.id)
        }
        break
      }
      case 'query': {
        const index = await this.memory.indexFor(indexKeys)
        for (const result of searchTabs(tabs, index, match.query, { limit: tabs.length })) keep.add(result.tab.id)
        break
      }
      case 'ids':
        for (const id of match.ids) keep.add(id)
        break
    }
    return keep
  }

  /** The tabs an operation may touch: matched, minus what the guard protects. */
  private async select(
    match: TabMatch,
    tabs: readonly TabInfo[],
    guard: TabGuard,
    options: { protectPinned: boolean; protectActive: boolean },
    draft: Draft,
  ): Promise<TabInfo[]> {
    const keep = await this.idsFor(match, tabs, tabs.map((tab) => urlKeyOf(tab.url)))
    const out: TabInfo[] = []
    for (const tab of tabs) {
      if (!keep.has(tab.id)) continue
      if (guard.keepIds.includes(tab.id)) {
        draft.add('skip', `kept ${tabLabel(tab)} — it is the tab Navigator is working in`)
        continue
      }
      if (options.protectPinned && tab.pinned) {
        draft.add('skip', `kept pinned tab ${tabLabel(tab)}`)
        continue
      }
      if (options.protectActive && tab.active) {
        draft.add('skip', `kept the active tab ${tabLabel(tab)}`)
        continue
      }
      out.push(tab)
    }
    return out
  }

  // ---------------------------------------------------------------- operations

  private async list(draft: Draft, match: TabMatch, tabs: TabInfo[]): Promise<void> {
    const keep = await this.idsFor(match, tabs, tabs.map((tab) => urlKeyOf(tab.url)))
    const windows = new Map<number, number>()
    for (const tab of tabs) windows.set(tab.windowId, (windows.get(tab.windowId) ?? 0) + 1)
    const scoped = match.scope === 'all' || match.scope === 'ids' ? '' : `; ${matchLabel(match)} = ${keep.size}`
    draft.add('note', `${tabs.length} open tab(s) across ${windows.size} window(s)${scoped}.`)
  }

  private async close(draft: Draft, match: TabMatch, tabs: TabInfo[], guard: TabGuard): Promise<void> {
    const targets = await this.select(match, tabs, guard, { protectPinned: true, protectActive: true }, draft)
    const lastInWindow = lastTabPerWindow(tabs)
    const closable: TabInfo[] = []
    for (const tab of targets) {
      if (lastInWindow.has(tab.windowId)) {
        draft.add('skip', `kept the only tab in window ${tab.windowId} — closing it would close the window`)
        continue
      }
      closable.push(tab)
    }
    if (closable.length === 0) return

    this.undo.record(closable.map(snapshot))
    await this.surface.remove(closable.map((tab) => tab.id))
    draft.closed = closable.length
    for (const tab of closable) draft.add('close', `closed ${tabLabel(tab)} (${hostOf(tab.url) || 'no host'})`)
    draft.add('note', `${closable.length} tab${closable.length === 1 ? '' : 's'} closed — UNDO available for 60s.`)
  }

  private async group(
    draft: Draft,
    match: TabMatch,
    tabs: TabInfo[],
    guard: TabGuard,
    signal?: AbortSignal,
  ): Promise<void> {
    const candidates = await this.select(match, tabs, guard, { protectPinned: false, protectActive: false }, draft)
    const usable = candidates.filter((tab) => !isProtectedScheme(tab.url) && tab.groupId < 0)
    if (usable.length === 0) {
      draft.add('note', 'Nothing new to group: every matched tab is already in a group or is a browser page.')
      return
    }

    let clusters = clusterTabs(usable)
    if (clusters.length === 0) {
      draft.add('note', `No two of the ${usable.length} tab(s) are similar enough to group — try grouping a narrower set.`)
      return
    }
    // Chrome rejects a group of one, and a one-tab "group" is not useful.
    clusters = clusters.filter((cluster) => cluster.tabs.length >= 2).slice(0, 12)

    const names = await this.nameClusters(draft, clusters, signal)
    let colour = 0
    for (const cluster of clusters) {
      const groupId = await this.surface.group(cluster.tabs.map((tab) => tab.id))
      const title = names.get(clusterKey(cluster)) ?? deterministicName(cluster)
      await this.surface.nameGroup(groupId, title, nextColour(TAB_GROUP_COLORS, colour++))
      draft.grouped += cluster.tabs.length
      draft.add('group', `grouped ${cluster.tabs.length} tabs as "${title}"`)
    }
  }

  private async nameClusters(
    draft: Draft,
    clusters: TabClusterLite[],
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (this.complete === undefined) return out
    try {
      const result = await this.complete(
        buildGroupNameMessages(clusters.map((cluster) => ({ id: clusterKey(cluster), tabs: cluster.tabs }))),
        'small',
        signal,
      )
      draft.promptTokens += result.usage.promptTokens
      draft.completionTokens += result.usage.completionTokens
      return parseGroupNames(result.message.content ?? '')
    } catch (error) {
      if (signal?.aborted === true) throw error
      return out
    }
  }

  private async ungroup(draft: Draft, match: TabMatch, tabs: TabInfo[], guard: TabGuard): Promise<void> {
    const keep = await this.idsFor(match, tabs, tabs.map((tab) => urlKeyOf(tab.url)))
    const ids = tabs.filter((tab) => keep.has(tab.id) && tab.groupId >= 0 && !guard.keepIds.includes(tab.id)).map((tab) => tab.id)
    if (ids.length === 0) {
      draft.add('note', 'No grouped tabs in that selection.')
      return
    }
    await this.surface.ungroup(ids)
    draft.add('ungroup', `ungrouped ${ids.length} tab${ids.length === 1 ? '' : 's'}`)
  }

  private async merge(draft: Draft, tabs: TabInfo[], guard: TabGuard): Promise<void> {
    const groups = findDuplicates(tabs).filter((group) => group.close.every((tab) => !guard.keepIds.includes(tab.id)))
    if (groups.length === 0) {
      draft.add('note', 'No duplicate tabs: every open URL is unique.')
      return
    }
    const closable = groups.flatMap((group) => group.close)
    this.undo.record(closable.map(snapshot))
    await this.surface.remove(closable.map((tab) => tab.id))
    draft.closed = closable.length
    for (const group of groups) {
      draft.add(
        'merge',
        `kept ${tabLabel(group.keep)} and closed ${group.close.length} duplicate${group.close.length === 1 ? '' : 's'}`,
      )
    }
    draft.add('note', `${closable.length} duplicate tab${closable.length === 1 ? '' : 's'} merged — UNDO available for 60s.`)
  }

  private async find(draft: Draft, query: string, tabs: TabInfo[]): Promise<void> {
    const results = await this.search(tabs, query)
    draft.found = results
    if (results.length === 0) {
      draft.add('search', `Nothing matched "${query}" in ${tabs.length} open tab(s).`)
      return
    }
    draft.add('search', `${results.length} match${results.length === 1 ? '' : 'es'} for "${query}":`)
    for (const result of results) {
      draft.add('search', `${whereLabel(result.where)} ${tabLabel(result.tab)} — ${result.snippet}`)
    }
  }

  private async switchTo(draft: Draft, query: string, tabs: TabInfo[]): Promise<void> {
    const [best] = await this.search(tabs, query)
    if (best === undefined) {
      draft.add('note', `No open tab matched "${query}".`)
      return
    }
    await this.surface.update(best.tab.id, { active: true })
    if (best.tab.discarded) draft.add('note', `${tabLabel(best.tab)} was suspended; Chrome reloads it now.`)
    draft.add('switch', `switched to ${tabLabel(best.tab)} (${hostOf(best.tab.url)})`)
  }

  private async search(tabs: TabInfo[], query: string): Promise<TabSearchResult[]> {
    const index = await this.memory.indexFor(tabs.map((tab) => urlKeyOf(tab.url)))
    const results = searchTabs(tabs, index, query)
    if (results.length > 0) return results
    // Nothing in titles or indexed text: fall back to a plain host/label scan.
    const terms = contentTokens(query)
    if (terms.length === 0) return results
    return tabs
      .filter((tab) => coverage(terms, `${tab.title} ${tab.url}`) > 0)
      .map((tab) => ({ tab, score: coverage(terms, `${tab.title} ${tab.url}`), where: 'url' as const, snippet: tab.url }))
      .slice(0, 8)
  }

  private async free(draft: Draft, match: TabMatch, tabs: TabInfo[], guard: TabGuard, limit: number): Promise<void> {
    const keep = await this.idsFor(match, tabs, tabs.map((tab) => urlKeyOf(tab.url)))
    const candidates = heavyCandidates(
      tabs.filter((tab) => keep.has(tab.id) && !guard.keepIds.includes(tab.id)),
      await this.memory.indexFor(tabs.map((tab) => urlKeyOf(tab.url))),
      limit,
    )
    if (candidates.length === 0) {
      draft.add('note', 'No inactive tab to suspend — everything matched is active, pinned, or already suspended.')
      return
    }
    const bytes = sumBytes(candidates.map((candidate) => candidate.bytes))
    for (const candidate of candidates) {
      await this.surface.update(candidate.tab.id, { discarded: true })
      draft.add('discard', `suspended ${tabLabel(candidate.tab)}`)
    }
    draft.freedBytes = bytes
    draft.add('note', `Suspended ${candidates.length} tab(s); about ${Math.round(bytes / (1024 * 1024))} MB released (estimate).`)
  }

  private async stale(draft: Draft, days: number, tabs: TabInfo[]): Promise<void> {
    const keys = tabs.map((tab) => urlKeyOf(tab.url))
    const stats = await this.memory.stats(keys)
    const stale = staleTabs(tabs, stats, { days, now: this.now() })
    draft.stale = stale
    if (stale.length === 0) {
      draft.add('stale', `Nothing untouched for ${days}+ days (${stats.size} URL(s) tracked).`)
      return
    }
    draft.add('stale', `${stale.length} tab(s) untouched for ${days}+ days — nothing was closed:`)
    for (const entry of stale.slice(0, 20)) {
      draft.add('stale', `${tabLabel(entry.tab)} · ${entry.daysIdle} day(s) idle`)
    }
    draft.add('note', 'Save them as a session to archive without losing them.')
  }

  private async index(draft: Draft, tabs: TabInfo[]): Promise<void> {
    const candidates = tabs.filter((tab) => !isProtectedScheme(tab.url)).slice(0, this.indexLimit)
    let written = 0
    let skipped = 0
    for (const tab of candidates) {
      const page = await this.surface.readPage(tab.id).catch(() => null)
      if (page === null || page.text.trim().length < 200) {
        skipped += 1
        continue
      }
      const key = urlKeyOf(tab.url)
      const text = page.text.slice(0, 200_000)
      await this.memory.putIndex({
        urlKey: key,
        url: page.url === '' ? tab.url : page.url,
        title: page.title === '' ? tab.title : page.title,
        text,
        chars: text.length,
        indexedAt: this.now(),
      })
      written += 1
    }
    draft.add('index', `Indexed ${written} page(s)${skipped > 0 ? `, skipped ${skipped} without readable text` : ''}.`)
  }

  private async save(draft: Draft, name: string, note: string, tags: string[], tabs: TabInfo[]): Promise<void> {
    const worth = tabs.filter((tab) => !isProtectedScheme(tab.url))
    if (worth.length === 0) {
      draft.add('session', 'Nothing worth saving: no web pages are open.')
      return
    }
    const session: SavedSession = {
      id: this.newId(),
      createdAt: this.now(),
      name: name === '' ? defaultSessionName(this.now()) : clip(name, 60),
      note: clip(note, 400),
      tags: tags.length > 0 ? tags.slice(0, 6) : autoTags(worth),
      tabs: worth.map((tab) => ({ url: tab.url, title: tab.title, windowId: tab.windowId, index: tab.index })),
    }
    await this.memory.putSession(session)
    draft.sessions = [session, ...(await this.memory.listSessions()).filter((other) => other.id !== session.id)]
    draft.add('session', `Saved ${session.tabs.length} tab(s) as "${session.name}" (tags: ${session.tags.join(', ')}).`)
  }

  private async restore(draft: Draft, name: string, tabs: TabInfo[]): Promise<void> {
    const sessions = await this.memory.listSessions()
    if (sessions.length === 0) {
      draft.add('session', 'No saved sessions yet.')
      return
    }
    const session = name === '' ? sessions[0]! : pickSession(sessions, name)
    if (session === null) {
      draft.add('session', `No saved session matches "${name}". Known: ${sessions.map((entry) => entry.name).join(', ')}.`)
      return
    }
    const open = new Set(tabs.map((tab) => urlKeyOf(tab.url)))
    let opened = 0
    let already = 0
    for (const entry of session.tabs) {
      if (open.has(urlKeyOf(entry.url))) {
        already += 1
        continue
      }
      await this.surface.create({ url: entry.url, active: false })
      opened += 1
    }
    draft.add('restore', `Restored "${session.name}": ${opened} tab(s) opened${already > 0 ? `, ${already} already open` : ''}.`)
  }

  private async undoClose(draft: Draft): Promise<void> {
    const snapshot = this.undo.take()
    if (snapshot === null) {
      draft.add('undo', 'Nothing to undo — the 60 second window has passed.')
      return
    }
    for (const tab of [...snapshot].sort((a, b) => a.index - b.index)) {
      const id = await this.surface.create({
        url: tab.url,
        ...(tab.windowId > 0 ? { windowId: tab.windowId } : {}),
        ...(tab.index >= 0 ? { index: tab.index } : {}),
        active: false,
      })
      if (tab.pinned) await this.surface.update(id, { pinned: true })
    }
    draft.add('undo', `Reopened ${snapshot.length} tab${snapshot.length === 1 ? '' : 's'}.`)
  }
}

// --------------------------------------------------------------------- helpers

function summarise(draft: Draft): string {
  const parts: string[] = []
  if (draft.closed > 0) parts.push(`${draft.closed} closed`)
  if (draft.grouped > 0) parts.push(`${draft.grouped} grouped`)
  if (draft.freedBytes > 0) parts.push(`${Math.round(draft.freedBytes / (1024 * 1024))} MB freed`)
  if (draft.found.length > 0) parts.push(`${draft.found.length} matched`)
  if (draft.stale.length > 0) parts.push(`${draft.stale.length} stale`)
  if (draft.sessions.length > 0) parts.push(`${draft.sessions.length} session(s)`)
  return parts.length === 0 ? 'no changes' : parts.join(', ')
}

function clusterKey(cluster: TabClusterLite): string {
  return `g${cluster.windowId}-${cluster.tabs[0]?.id ?? 0}`
}

function nextColour(colors: TabGroupColor[], index: number): TabGroupColor {
  return colors[index % colors.length]!
}

function snapshot(tab: TabInfo): ClosedSnapshot {
  return { url: tab.url, title: tab.title, windowId: tab.windowId, index: tab.index, pinned: tab.pinned }
}

/** Windows that would close entirely if their last tab went. */
function lastTabPerWindow(tabs: readonly TabInfo[]): Set<number> {
  const counts = new Map<number, number>()
  for (const tab of tabs) counts.set(tab.windowId, (counts.get(tab.windowId) ?? 0) + 1)
  const out = new Set<number>()
  for (const [windowId, count] of counts) if (count === 1) out.add(windowId)
  return out
}

function whereLabel(where: TabSearchResult['where']): string {
  if (where === 'content') return 'in page text:'
  if (where === 'both') return 'title and page text:'
  if (where === 'url') return 'in URL:'
  return 'in title:'
}

function defaultSessionName(now: number): string {
  const date = new Date(now)
  return `Session ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

/** The three most common sites make decent default tags — as three labels, not three repeats of one. */
function autoTags(tabs: readonly TabInfo[]): string[] {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    const site = siteOf(tab.url)
    if (site === '') continue
    counts.set(site, (counts.get(site) ?? 0) + 1)
  }
  const out: string[] = []
  for (const [site] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (out.length >= 3) break
    const label = hostLabel(`https://${site}`)
    if (out.includes(label)) continue
    out.push(label)
  }
  return out
}

function pickSession(sessions: readonly SavedSession[], name: string): SavedSession | null {
  const needle = name.toLowerCase()
  const exact = sessions.find((session) => session.name.toLowerCase() === needle)
  if (exact !== undefined) return exact
  const partial = sessions.find((session) => session.name.toLowerCase().includes(needle) || needle.includes(session.name.toLowerCase()))
  if (partial !== undefined) return partial
  const terms = contentTokens(name)
  if (terms.length === 0) return null
  let best: { session: SavedSession; score: number } | null = null
  for (const session of sessions) {
    const score = coverage(terms, `${session.name} ${session.tags.join(' ')} ${session.note}`)
    if (score >= 0.4 && (best === null || score > best.score)) best = { session, score }
  }
  return best === null ? null : best.session
}
