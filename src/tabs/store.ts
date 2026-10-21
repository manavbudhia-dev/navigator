import { db, type SessionRow, type TabIndexRow, type TabStatRow } from '@/memory/db'
import { isProtectedScheme, urlKeyOf } from './model'
import type { SavedSession, TabIndexEntry, TabInfo, TabMemory, TabStat } from './types'

/**
 * Tab persistence (spec §8), over the same Dexie database the rest of the
 * extension uses: a last-seen clock per URL, the page-text index tab search
 * reads, and saved sessions.
 *
 * Chrome gives us no per-tab usage timestamp, so "untouched for X days" is
 * only answerable for URLs we have watched. `touch` is called from the tab
 * listeners in the background and at the start of every manager run.
 */

/** A second view of the same page within this window is one open, not two. */
const OPEN_GAP_MS = 10 * 60 * 1000

/** Bounded so the index cannot grow without limit on a hoarder's window. */
const MAX_INDEX_ROWS = 400
const MAX_INDEX_CHARS = 60_000

function toStat(row: TabStatRow | undefined): TabStat | undefined {
  if (row === undefined) return undefined
  return { urlKey: row.urlKey, title: row.title, lastSeenAt: row.lastSeenAt, opens: row.opens }
}

async function touchOne(urlKey: string, title: string, at: number): Promise<void> {
  const existing = await db.tabStats.get(urlKey)
  if (existing === undefined) {
    await db.tabStats.put({ urlKey, title, lastSeenAt: at, opens: 1 })
    return
  }
  const countsAsNewOpen = at - existing.lastSeenAt > OPEN_GAP_MS
  await db.tabStats.put({
    urlKey,
    title: title === '' ? existing.title : title,
    lastSeenAt: Math.max(existing.lastSeenAt, at),
    opens: existing.opens + (countsAsNewOpen ? 1 : 0),
  })
}

export const tabMemory: TabMemory = {
  async touch(tabs, at) {
    const seen = new Set<string>()
    for (const tab of tabs) {
      if (isProtectedScheme(tab.url) || tab.discarded) continue
      const key = urlKeyOf(tab.url)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      await touchOne(key, tab.title, at)
    }
  },

  async stats(urlKeys) {
    const unique = [...new Set(urlKeys.filter((key) => key !== ''))]
    const rows = await db.tabStats.bulkGet(unique)
    const out = new Map<string, TabStat>()
    rows.forEach((row) => {
      const stat = toStat(row)
      if (stat !== undefined) out.set(stat.urlKey, stat)
    })
    return out
  },

  async putIndex(entry) {
    const row: TabIndexRow = { ...entry, text: entry.text.slice(0, MAX_INDEX_CHARS), chars: Math.min(entry.chars, MAX_INDEX_CHARS) }
    await db.tabIndex.put(row)
    const stale = await db.tabIndex.orderBy('indexedAt').reverse().offset(MAX_INDEX_ROWS).primaryKeys()
    if (stale.length > 0) await db.tabIndex.bulkDelete(stale)
  },

  async indexFor(urlKeys) {
    const unique = [...new Set(urlKeys.filter((key) => key !== ''))]
    const rows = await db.tabIndex.bulkGet(unique)
    const out = new Map<string, TabIndexEntry>()
    for (const row of rows) {
      if (row !== undefined) out.set(row.urlKey, row)
    }
    return out
  },

  async putSession(session) {
    await db.sessions.put(toRow(session))
  },

  async deleteSession(id) {
    await db.sessions.delete(id)
  },

  async listSessions() {
    const rows = await db.sessions.orderBy('createdAt').reverse().toArray()
    return rows.map(toSaved)
  },
}

/** Called by the background tab listeners; `at` defaults to now. */
export async function touchTabs(tabs: readonly TabInfo[], at = Date.now()): Promise<void> {
  await tabMemory.touch(tabs, at)
}

function toRow(session: SavedSession): SessionRow {  return {
    id: session.id,
    createdAt: session.createdAt,
    name: session.name,
    note: session.note,
    tags: session.tags,
    tabs: session.tabs.map((tab) => ({ url: tab.url, title: tab.title, windowId: tab.windowId, index: tab.index })),
  }
}

export function toSaved(row: SessionRow): SavedSession {
  return {
    id: row.id,
    createdAt: row.createdAt,
    name: row.name,
    note: row.note,
    tags: Array.isArray(row.tags) ? row.tags : [],
    tabs: Array.isArray(row.tabs) ? row.tabs : [],
  }
}

/** The panel reads sessions straight out of IndexedDB, like the research panel. */
export async function savedSessions(): Promise<SavedSession[]> {
  return tabMemory.listSessions()
}

export async function deleteSavedSession(id: string): Promise<void> {
  await tabMemory.deleteSession(id)
}
