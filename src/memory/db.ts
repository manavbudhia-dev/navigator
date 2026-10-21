import Dexie, { type Table } from 'dexie'

import type { ActTarget } from '@/types/actions'

export interface SettingRow {
  key: string
  value: unknown
}

/**
 * One row per agent action — who asked, what ran, what decided it (spec §9d).
 * The optional extras are what turns the log from "a list of tool calls" into
 * evidence: which page, how long, what it cost, and what it looked like after.
 */
export interface AuditRow {
  id?: number
  at: number
  /** Every row written by one task run shares this, so history never has to guess. */
  runId?: string
  goal: string
  tool: string
  args: Record<string, unknown>
  risk: string
  hardBlock: string | null
  decision: string
  ok: boolean | null
  detail: string
  /** Page the action was taken on. */
  url?: string
  /** Wall-clock duration of the tool call itself. */
  ms?: number
  /** Tokens of the LLM turn that asked for this action, charged to its first row. */
  promptTokens?: number
  completionTokens?: number
  /** Downscaled JPEG of the page after the action, as a data URL. */
  thumb?: string
  /**
   * The control an action touched, so a finished run can be replayed later
   * without asking the model where the "Submit" button went (spec §11).
   */
  target?: ActTarget
}

/** An encrypted profile: nothing about its contents is readable while locked. */
export interface VaultRow {
  id: string
  updatedAt: number
  cipher: string
  iv: string
}

/** One research run minus its sources, which live in their own table. */
export interface ResearchRunRow {
  id: string
  createdAt: number
  question: string
  depth: string
  answer: string
  brief: string[]
  citations: unknown[]
  clusters: unknown[]
  contradictions: unknown[]
  discarded: unknown[]
  gaps: string[]
  rounds: number
  promptTokens: number
  completionTokens: number
}

/** One gathered source note (spec §7), keyed by run + url. */
export interface ResearchNoteRow {
  id: string
  runId: string
  url: string
  note: unknown
}

/** When a URL was last in the foreground — the tab manager's only clock. */
export interface TabStatRow {
  urlKey: string
  title: string
  lastSeenAt: number
  opens: number
}

/** Page text of one URL, so tab search can look inside pages (spec §8). */
export interface TabIndexRow {
  urlKey: string
  url: string
  title: string
  text: string
  chars: number
  indexedAt: number
}

/** A named, tagged snapshot of open tabs (spec §8). */
export interface SessionRow {
  id: string
  createdAt: number
  name: string
  note: string
  tags: string[]
  tabs: { url: string; title: string; windowId: number; index: number }[]
}

/**
 * A saved workflow (spec §11). Stored as one document per row: the step list
 * is always read and written whole, so indexing inside it would buy nothing.
 */
export interface RecipeRow {
  id: string
  name: string
  goal: string
  updatedAt: number
  /** True while a `chrome.alarms` entry exists for it (spec §11 scheduling). */
  scheduled: boolean
  /** The `Recipe` document itself, kept in one column so later fields need no migration. */
  document: unknown
}

/**
 * Local persistence. IndexedDB is available in both the service worker and
 * the side panel, so every context reads the same settings. Later batches
 * add tables for memory entries and recipes here.
 */
export class NavigatorDB extends Dexie {
  settings!: Table<SettingRow, string>
  audit!: Table<AuditRow, number>
  vault!: Table<VaultRow, string>
  researchRuns!: Table<ResearchRunRow, string>
  researchNotes!: Table<ResearchNoteRow, string>
  tabStats!: Table<TabStatRow, string>
  tabIndex!: Table<TabIndexRow, string>
  sessions!: Table<SessionRow, string>
  recipes!: Table<RecipeRow, string>

  constructor() {
    super('navigator')
    this.version(1).stores({
      settings: 'key',
    })
    this.version(2).stores({
      settings: 'key',
      audit: '++id, at, tool',
    })
    this.version(3).stores({
      settings: 'key',
      audit: '++id, at, tool',
      vault: 'id, updatedAt',
    })
    this.version(4).stores({
      settings: 'key',
      audit: '++id, at, tool',
      vault: 'id, updatedAt',
      researchRuns: 'id, createdAt',
      researchNotes: 'id, runId, url',
    })
    // Tab manager (spec §8): last-seen clock, page-text index, saved sessions.
    this.version(5).stores({
      settings: 'key',
      audit: '++id, at, tool',
      vault: 'id, updatedAt',
      researchRuns: 'id, createdAt',
      researchNotes: 'id, runId, url',
      tabStats: 'urlKey, lastSeenAt',
      tabIndex: 'urlKey, indexedAt',
      sessions: 'id, createdAt',
    })
    // Audit log (spec §9): rows are grouped by run, not by a time-window guess.
    this.version(6).stores({
      settings: 'key',
      audit: '++id, at, tool, runId',
      vault: 'id, updatedAt',
      researchRuns: 'id, createdAt',
      researchNotes: 'id, runId, url',
      tabStats: 'urlKey, lastSeenAt',
      tabIndex: 'urlKey, indexedAt',
      sessions: 'id, createdAt',
    })
    // Recipes (spec §11): saved workflows, plus the audit rows that carry the
    // element each action touched.
    this.version(7).stores({
      settings: 'key',
      audit: '++id, at, tool, runId',
      vault: 'id, updatedAt',
      researchRuns: 'id, createdAt',
      researchNotes: 'id, runId, url',
      tabStats: 'urlKey, lastSeenAt',
      tabIndex: 'urlKey, indexedAt',
      sessions: 'id, createdAt',
      recipes: 'id, updatedAt, scheduled',
    })
  }
}

export const db = new NavigatorDB()
