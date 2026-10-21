import type { SavedSession, TabIndexEntry, TabInfo, TabMemory, TabStat, TabSurface } from './types'
import { urlKeyOf } from './model'

/** Test builder: a tab with everything defaulted except what the test cares about. */
export function tab(id: number, input: Partial<TabInfo> = {}): TabInfo {
  return {
    id,
    windowId: input.windowId ?? 1,
    index: input.index ?? id,
    url: input.url ?? `https://example.com/${id}`,
    title: input.title ?? `Page ${id}`,
    active: input.active ?? false,
    pinned: input.pinned ?? false,
    discarded: input.discarded ?? false,
    groupId: input.groupId ?? -1,
  }
}

/** A fake in-memory tab universe that behaves like `TabSurface`. */
export interface FakeSurfaceOptions {
  tabs: TabInfo[]
  /** Records every mutation for assertions. */
  log?: string[]
  /** Text returned by readPage, keyed by tab id. */
  pages?: Map<number, { url: string; title: string; text: string }>
  failRemove?: number[]
}

export interface FakeSurface extends TabSurface {
  /** Group ids handed out, for assertions. */
  readonly created: number[]
  readonly log: string[]
  snapshot(): TabInfo[]
}

export function fakeSurface(options: FakeSurfaceOptions): FakeSurface {
  // Copy the fixtures: a fake that groups or discards must not mutate objects
  // another test case still holds.
  const tabs = options.tabs.map((entry) => ({ ...entry }))
  const log = options.log ?? []
  const created: number[] = []
  let nextGroupId = 100
  let nextTabId = Math.max(...tabs.map((entry) => entry.id), 0) + 1000

  function touch(entry: string): void {
    log.push(entry)
  }

  return {
    created,
    log,
    snapshot: () => tabs.map((entry) => ({ ...entry })),

    async list() {
      return tabs.map((entry) => ({ ...entry }))
    },

    async groups() {
      return []
    },

    async update(tabId, changes) {
      const entry = tabs.find((candidate) => candidate.id === tabId)
      if (entry === undefined) throw new Error(`No tab ${tabId}`)
      touch(`update ${tabId} ${JSON.stringify(changes)}`)
      if (changes.active !== undefined) entry.active = changes.active
      if (changes.pinned !== undefined) entry.pinned = changes.pinned
      if (changes.discarded !== undefined) entry.discarded = changes.discarded
      if (changes.index !== undefined) entry.index = changes.index
    },

    async create(newTab) {
      nextTabId += 1
      const id = nextTabId
      created.push(id)
      touch(`create ${newTab.url}`)
      tabs.push(
        tab(id, {
          url: newTab.url,
          title: '',
          windowId: newTab.windowId ?? 1,
          index: newTab.index ?? tabs.length,
          active: newTab.active,
        }),
      )
      return id
    },

    async remove(tabIds) {
      if (options.failRemove !== undefined && tabIds.some((id) => options.failRemove?.includes(id))) {
        throw new Error('Chrome refused to close the tab')
      }
      for (const id of tabIds) {
        const at = tabs.findIndex((entry) => entry.id === id)
        if (at >= 0) tabs.splice(at, 1)
        touch(`remove ${id}`)
      }
    },

    async group(tabIds) {
      const groupId = nextGroupId
      nextGroupId += 1
      touch(`group ${tabIds.join('+')}`)
      for (const id of tabIds) {
        const entry = tabs.find((candidate) => candidate.id === id)
        if (entry !== undefined) entry.groupId = groupId
      }
      return groupId
    },

    async ungroup(tabIds) {
      touch(`ungroup ${tabIds.join('+')}`)
      for (const id of tabIds) {
        const entry = tabs.find((candidate) => candidate.id === id)
        if (entry !== undefined) entry.groupId = -1
      }
    },

    async nameGroup(groupId, title, color) {
      touch(`name ${groupId} "${title}" ${color}`)
    },

    async readPage(tabId) {
      const page = options.pages?.get(tabId)
      touch(`read ${tabId}`)
      return page === undefined ? null : { ...page }
    },
  }
}

/** A `TabMemory` that keeps stats, index rows and sessions in maps. */
export interface FakeMemory extends TabMemory {
  statsMap: Map<string, TabStat>
  indexMap: Map<string, TabIndexEntry>
  saved: SavedSession[]
}

export function statsMap(stats: readonly TabStat[]): Map<string, TabStat> {
  return new Map(stats.map((stat) => [stat.urlKey, stat]))
}

export function indexMap(entries: readonly TabIndexEntry[]): Map<string, TabIndexEntry> {
  return new Map(entries.map((entry) => [entry.urlKey, entry]))
}

export function fakeMemory(seed: Partial<FakeMemory> = {}): FakeMemory {
  const memory: FakeMemory = {
    statsMap: seed.statsMap ?? new Map(),
    indexMap: seed.indexMap ?? new Map(),
    saved: seed.saved ?? [],

    async touch(tabs, at) {
      for (const entry of tabs) {
        const key = urlKeyOf(entry.url)
        const existing = memory.statsMap.get(key)
        memory.statsMap.set(key, {
          urlKey: key,
          title: entry.title,
          lastSeenAt: existing === undefined ? at : Math.max(existing.lastSeenAt, at),
          opens: existing === undefined ? 1 : existing.opens + 1,
        })
      }
    },

    async stats(urlKeys) {
      const out = new Map<string, TabStat>()
      for (const key of urlKeys) {
        const stat = memory.statsMap.get(key)
        if (stat !== undefined) out.set(key, stat)
      }
      return out
    },

    async putIndex(entry) {
      memory.indexMap.set(entry.urlKey, entry)
    },

    async indexFor(urlKeys) {
      const out = new Map<string, TabIndexEntry>()
      for (const key of urlKeys) {
        const entry = memory.indexMap.get(key)
        if (entry !== undefined) out.set(key, entry)
      }
      return out
    },

    async putSession(session) {
      memory.saved = [session, ...memory.saved.filter((other) => other.id !== session.id)]
    },

    async deleteSession(id) {
      memory.saved = memory.saved.filter((session) => session.id !== id)
    },

    async listSessions() {
      return [...memory.saved].sort((a, b) => b.createdAt - a.createdAt)
    },
  }
  return memory
}
