import { db, type AuditRow } from '@/memory/db'

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
}

export async function recordAudit(input: AuditInput, persist = true): Promise<AuditRow> {
  const row: AuditRow = { at: Date.now(), ...input }
  if (persist) {
    try {
      await db.audit.add(row)
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
