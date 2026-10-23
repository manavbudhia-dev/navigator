import { db, type AuditRow } from '@/memory/db'
import type { ActTarget } from '@/types/actions'

/**
 * Audit log (spec §9d): every attempted action is recorded — including ones
 * that were blocked — so the History tab can show exactly what the agent
 * did, when, and who approved it.
 */

export interface AuditInput {
  goal: string
  tool: string
  args: Record<string, unknown>
  risk: AuditRow['risk']
  hardBlock: string | null
  decision: AuditRow['decision']
  /** null while the action is still pending approval. */
  ok: boolean | null
  detail: string
  runId?: string
  url?: string
  ms?: number
  promptTokens?: number
  completionTokens?: number
  thumb?: string
  target?: ActTarget
}

/**
 * How much history is kept. Rows carry a JPEG thumbnail each, so an unbounded
 * log would quietly eat the disk; the oldest rows go first and a run is one
 * contiguous group, so a trim only ever clips the tail of an old session.
 */
export const AUDIT_MAX_ROWS = 2_000

/** Same shape as the other local stores' caps: keep the newest rows, drop the rest. */
async function trim(): Promise<void> {
  const past = await db.audit.orderBy('at').reverse().offset(AUDIT_MAX_ROWS).primaryKeys()
  if (past.length > 0) await db.audit.bulkDelete(past as number[])
}

export async function recordAudit(input: AuditInput, persist = true): Promise<AuditRow> {
  const row: AuditRow = { at: Date.now(), ...input }
  if (persist) {
    try {
      await db.audit.add(row)
      await trim()
    } catch (error) {
      // A failed write must never abort a running task.
      console.warn('[navigator] audit write failed', error)
    }
  }
  return row
}

export async function recentAudit(limit = 50): Promise<AuditRow[]> {
  return db.audit.orderBy('at').reverse().limit(limit).toArray()
}
