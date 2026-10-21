import { db, type MemoryRow } from './db'
import { cleanTags, MAX_MEMORIES, MAX_MEMORY_CHARS, normalizeNote, rankMemories, type MemoryEntry, type NewMemory } from './recall'

export type { MemoryEntry, NewMemory } from './recall'

/**
 * Long-term memory storage (spec §4). One row is one sentence the agent
 * decided was worth keeping — a preference, a fact it looked up, the shape of
 * a site it has to visit again. Notes are plain text in IndexedDB on this
 * machine; anything secret belongs in the encrypted vault instead.
 */

function toEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id ?? 0,
    at: row.at,
    text: row.text,
    tags: Array.isArray(row.tags) ? row.tags : [],
    url: row.url ?? '',
  }
}

/**
 * Write one note. The same sentence written twice refreshes the first rather
 * than filling the library with near-duplicates a later recall has to read.
 */
export async function saveMemory(input: NewMemory, at = Date.now()): Promise<MemoryEntry> {
  const text = normalizeNote(input.text).slice(0, MAX_MEMORY_CHARS)
  if (text === '') throw new Error('A memory needs some text.')
  const tags = cleanTags(input.tags)
  const url = (input.url ?? '').slice(0, 400)

  const rows = await db.memories.toArray()
  const twin = rows.find((row) => normalizeNote(row.text) === text)
  if (twin !== undefined && twin.id !== undefined) {
    const merged: MemoryRow = {
      ...twin,
      at,
      tags: cleanTags([...(Array.isArray(twin.tags) ? twin.tags : []), ...tags]),
      url: url !== '' ? url : twin.url,
    }
    await db.memories.put(merged)
    return toEntry(merged)
  }

  const id = await db.memories.add({ at, text, tags, url })
  const past = await db.memories.orderBy('at').reverse().offset(MAX_MEMORIES).primaryKeys()
  if (past.length > 0) await db.memories.bulkDelete(past)
  return { id, at, text, tags, url }
}

export async function listMemories(): Promise<MemoryEntry[]> {
  return (await db.memories.orderBy('at').reverse().toArray()).map(toEntry)
}

export async function recallMemories(query: string, limit = 8, at = Date.now()): Promise<MemoryEntry[]> {
  return rankMemories(query, (await db.memories.toArray()).map(toEntry), limit, at)
}

export async function deleteMemory(id: number): Promise<void> {
  await db.memories.delete(id)
}

export async function clearMemories(): Promise<void> {
  await db.memories.clear()
}
