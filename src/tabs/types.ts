import type { ChatMessage, CompletionResult } from '@/llm/types'

/**
 * Tab manager vocabulary (spec §8). Mirror of the research engine's design:
 * nothing in `/src/tabs` imports Chrome. The manager talks to the browser
 * through `TabSurface` and to persistence through `TabMemory`, so clustering,
 * duplicate merging, the stale sweeper and the undo buffer all run unchanged
 * in unit tests and headless scripts.
 */

/** One browser tab, normalised: Chrome leaves `url`/`title` undefined, we do not. */
export interface TabInfo {
  id: number
  windowId: number
  index: number
  url: string
  title: string
  active: boolean
  pinned: boolean
  discarded: boolean
  /** -1 when the tab is not in a group. */
  groupId: number
}

export interface TabGroupInfo {
  id: number
  title: string
  color: TabGroupColor
}

export type TabGroupColor = 'blue' | 'red' | 'yellow' | 'green' | 'cyan' | 'pink' | 'purple' | 'orange' | 'grey'

/** Order auto-grouping assigns colours in (spec §8: "assign color"). */
export const TAB_GROUP_COLORS: TabGroupColor[] = [
  'blue',
  'green',
  'yellow',
  'cyan',
  'purple',
  'pink',
  'orange',
  'grey',
  'red',
]

export interface TabUpdate {
  url?: string
  active?: boolean
  pinned?: boolean
  /** `discard()` frees the tab's renderer memory — spec "memory saver". */
  discarded?: boolean
  index?: number
  windowId?: number
}

/** Main text of a page, read from a tab that is already open. */
export interface TabPage {
  url: string
  title: string
  text: string
}

export interface NewTab {
  url: string
  windowId?: number
  index?: number
  active: boolean
}

/** Everything the manager may do to the browser. */
export interface TabSurface {
  list(): Promise<TabInfo[]>
  groups(): Promise<TabGroupInfo[]>
  update(tabId: number, changes: TabUpdate): Promise<void>
  create(tab: NewTab): Promise<number>
  remove(tabIds: number[]): Promise<void>
  /** Returns the id of the group the tabs ended up in. */
  group(tabIds: number[]): Promise<number>
  ungroup(tabIds: number[]): Promise<void>
  nameGroup(groupId: number, title: string, color: TabGroupColor): Promise<void>
  /** Page text of an already-open tab, or null when there is no content script. */
  readPage(tabId: number): Promise<TabPage | null>
}

/** Which tabs a command or tool applies to. */
export type TabMatch =
  | { scope: 'all' }
  | { scope: 'others' }
  | { scope: 'host'; host: string }
  | { scope: 'query'; query: string }
  | { scope: 'ids'; ids: number[] }

export type TabIntent =
  | { kind: 'list'; match: TabMatch }
  | { kind: 'close'; match: TabMatch }
  | { kind: 'group'; match: TabMatch }
  | { kind: 'ungroup'; match: TabMatch }
  | { kind: 'merge'; match: TabMatch }
  | { kind: 'find'; query: string }
  | { kind: 'switch'; query: string }
  | { kind: 'free'; match: TabMatch; maxTabs?: number }
  | { kind: 'stale'; days: number }
  | { kind: 'index' }
  | { kind: 'save'; name: string; note: string; tags: string[] }
  | { kind: 'restore'; name: string }
  | { kind: 'sessions' }
  | { kind: 'undo' }

export type TabIntentKind = TabIntent['kind']

/** What we remember about a URL so "untouched for X days" is answerable. */
export interface TabStat {
  urlKey: string
  title: string
  lastSeenAt: number
  opens: number
}

/** One indexed page: the corpus semantic tab search runs over (spec §8). */
export interface TabIndexEntry {
  urlKey: string
  url: string
  title: string
  text: string
  chars: number
  indexedAt: number
}

export interface SessionTab {
  url: string
  title: string
  windowId: number
  index: number
}

/** A named, tagged snapshot of an entire browsing session (spec §8). */
export interface SavedSession {
  id: string
  createdAt: number
  name: string
  note: string
  tags: string[]
  tabs: SessionTab[]
}

/** A set of tabs that belong together, before Chrome hands back a group id. */
export interface TabClusterLite {
  windowId: number
  tabs: TabInfo[]
  /** Terms shared by more than one member — used for the fallback name. */
  terms: string[]
  host: string
}

export interface StaleTab {
  tab: TabInfo
  lastSeenAt: number
  daysIdle: number
}

export interface TabSearchResult {
  tab: TabInfo
  score: number
  /** Where the match came from, so the UI can be honest about it. */
  where: 'title' | 'url' | 'content' | 'both'
  snippet: string
}

export type TabLineKind =
  | 'close'
  | 'group'
  | 'ungroup'
  | 'merge'
  | 'switch'
  | 'discard'
  | 'index'
  | 'session'
  | 'restore'
  | 'search'
  | 'stale'
  | 'skip'
  | 'undo'
  | 'note'
  | 'error'

export interface TabLine {
  kind: TabLineKind
  text: string
}

/** Tabs closed by the last bulk operation — what UNDO puts back (spec §8). */
export interface UndoState {
  tabs: number
  expiresAt: number
}

export interface TabReport {
  ok: boolean
  intent: TabIntentKind
  summary: string
  lines: TabLine[]
  /** Fresh snapshot of every open tab, taken after the operation. */
  tabs: TabInfo[]
  found: TabSearchResult[]
  stale: StaleTab[]
  sessions: SavedSession[]
  closed: number
  grouped: number
  freedBytes: number
  undo: UndoState | null
  error: string | null
  promptTokens: number
  completionTokens: number
}

/** Model access, same shape the research engine uses. */
export type TabComplete = (
  messages: ChatMessage[],
  kind: 'big' | 'small',
  signal?: AbortSignal,
) => Promise<CompletionResult>

/**
 * Persistence the manager needs: last-seen bookkeeping (so staleness is
 * answerable), the page-text index (so tab search sees inside pages), and
 * saved sessions. Implemented over Dexie in `store.ts`.
 */
export interface TabMemory {
  touch(tabs: readonly TabInfo[], at: number): Promise<void>
  stats(urlKeys: readonly string[]): Promise<Map<string, TabStat>>
  putIndex(entry: TabIndexEntry): Promise<void>
  indexFor(urlKeys: readonly string[]): Promise<Map<string, TabIndexEntry>>
  putSession(session: SavedSession): Promise<void>
  deleteSession(id: string): Promise<void>
  listSessions(): Promise<SavedSession[]>
}

/** Defaults for the stale sweeper and the memory saver. */
export const DEFAULT_STALE_DAYS = 7
export const UNDO_WINDOW_MS = 60_000

/** How many tabs one "free memory" pass is allowed to suspend. */
export const DEFAULT_FREE_TABS = 8
export const MAX_FREE_TABS = 25

export function clampFreeTabs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_FREE_TABS
  return Math.min(MAX_FREE_TABS, Math.max(1, Math.round(value)))
}

export function clampDays(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_STALE_DAYS
  return Math.min(365, Math.max(1, Math.round(value)))
}
