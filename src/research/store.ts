import { db, type ResearchNoteRow, type ResearchRunRow } from '@/memory/db'
import type { Citation, ClaimCluster, Contradiction, DiscardedSource, ResearchResult, SourceNote } from './types'
import { clampConcurrency, DEFAULT_CONCURRENCY } from './types'

/**
 * Research persistence (spec §7): the report and its source notes are stored
 * so the panel can reopen a past run and keep asking questions of the corpus
 * without re-reading the web.
 */

const CONCURRENCY_KEY = 'research-concurrency'

/** Background tabs opened at once — configurable, but the engine clamps it to 8. */
export async function loadTabConcurrency(): Promise<number> {
  const value = (await db.settings.get(CONCURRENCY_KEY))?.value
  return typeof value === 'number' ? clampConcurrency(value) : DEFAULT_CONCURRENCY
}

export async function saveTabConcurrency(value: number): Promise<void> {
  await db.settings.put({ key: CONCURRENCY_KEY, value: clampConcurrency(value) })
}

export function noteRowId(runId: string, url: string): string {
  return `${runId}|${url}`
}

export async function saveResearchResult(result: ResearchResult): Promise<void> {
  const row: ResearchRunRow = {
    id: result.id,
    createdAt: result.createdAt,
    question: result.question,
    depth: result.depth,
    answer: result.answer,
    brief: result.brief,
    citations: result.citations,
    clusters: result.clusters,
    contradictions: result.contradictions,
    discarded: result.discarded,
    gaps: result.gaps,
    rounds: result.rounds,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  }
  const notes: ResearchNoteRow[] = result.sources.map((note) => ({
    id: noteRowId(result.id, note.url),
    runId: result.id,
    url: note.url,
    note,
  }))

  await db.transaction('rw', db.researchRuns, db.researchNotes, async () => {
    await db.researchNotes.where('runId').equals(result.id).delete()
    await db.researchRuns.put(row)
    await db.researchNotes.bulkPut(notes)
  })
}

/** Rows are stored as JSON, so the read path re-checks the shape it returns. */
function isSource(value: unknown): value is SourceNote {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['url'] === 'string' && typeof record['title'] === 'string' && Array.isArray(record['claims'])
}

export async function loadResearchResult(id: string): Promise<ResearchResult | null> {
  const row = await db.researchRuns.get(id)
  if (!row) return null
  const noteRows = await db.researchNotes.where('runId').equals(id).toArray()
  const sources = noteRows.map((entry) => entry.note).filter(isSource)
  return hydrate(row, sources)
}

export function hydrate(row: ResearchRunRow, sources: SourceNote[]): ResearchResult {
  return {
    id: row.id,
    question: row.question,
    depth: row.depth === 'deep' ? 'deep' : row.depth === 'quick' ? 'quick' : 'standard',
    createdAt: row.createdAt,
    answer: row.answer,
    brief: row.brief,
    citations: row.citations as Citation[],
    clusters: row.clusters as ClaimCluster[],
    contradictions: row.contradictions as Contradiction[],
    discarded: row.discarded as DiscardedSource[],
    gaps: row.gaps,
    rounds: row.rounds,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    sources,
  }
}

export async function listResearchRuns(limit = 20): Promise<ResearchRunRow[]> {
  return db.researchRuns.orderBy('createdAt').reverse().limit(limit).toArray()
}

/** The newest finished run — what the panel shows when it opens. */
export async function latestResearchResult(): Promise<ResearchResult | null> {
  const [row] = await db.researchRuns.orderBy('createdAt').reverse().limit(1).toArray()
  if (!row) return null
  return loadResearchResult(row.id)
}

export async function deleteResearchRun(id: string): Promise<void> {
  await db.transaction('rw', db.researchRuns, db.researchNotes, async () => {
    await db.researchNotes.where('runId').equals(id).delete()
    await db.researchRuns.delete(id)
  })
}
