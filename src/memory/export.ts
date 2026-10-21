import { db, type AuditRow } from './db'

/**
 * Audit export (spec §9): the log is the user's evidence, so it leaves as
 * plain JSON — including the screenshots, because a log you cannot show is
 * not much of an audit trail.
 */

export interface AuditExport {
  exportedAt: number
  app: 'navigator'
  rows: number
  log: AuditRow[]
}

/** Pure so the shape is testable without IndexedDB. */
export function auditExportJson(log: AuditRow[], exportedAt = Date.now()): string {
  const payload: AuditExport = { exportedAt, app: 'navigator', rows: log.length, log }
  return JSON.stringify(payload, null, 2)
}

export async function buildAuditExport(limit = 2000): Promise<string> {
  const log = await db.audit.orderBy('at').limit(limit).toArray()
  return auditExportJson(log)
}
