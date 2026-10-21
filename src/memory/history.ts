import { db, type AuditRow } from './db'

/**
 * Sessions are reconstructed from the audit log (spec §9d) rather than stored
 * separately: two rows written minutes apart under the same goal belong to one
 * task, which is enough to rebuild "what did the agent do yesterday".
 */

export type SessionOutcome = 'success' | 'failed' | 'stopped' | 'unknown'

export interface AuditSession {
  id: string
  goal: string
  startedAt: number
  endedAt: number
  rows: AuditRow[]
  actions: number
  blocked: number
  outcome: SessionOutcome
}

/** Two rows further apart than this under the same goal start a new session. */
export const SESSION_GAP_MS = 30 * 60 * 1000

function isBlocked(row: AuditRow): boolean {
  return row.decision === 'block' || row.decision === 'denied'
}

function outcomeOf(rows: AuditRow[]): SessionOutcome {
  const finish = rows.filter((row) => row.tool === 'finish').at(-1)
  if (finish) return finish.ok === true ? 'success' : 'failed'
  return rows.some(isBlocked) ? 'stopped' : 'unknown'
}

/** Accepts rows in any order, returns newest session first. */
export function groupSessions(input: AuditRow[], gapMs = SESSION_GAP_MS): AuditSession[] {
  interface Draft {
    goal: string
    startedAt: number
    endedAt: number
    rows: AuditRow[]
  }

  const drafts: Draft[] = []
  for (const row of [...input].sort((a, b) => a.at - b.at)) {
    const last = drafts.at(-1)
    if (last && last.goal === row.goal && row.at - last.endedAt <= gapMs) {
      last.rows.push(row)
      last.endedAt = row.at
    } else {
      drafts.push({ goal: row.goal, startedAt: row.at, endedAt: row.at, rows: [row] })
    }
  }

  return drafts
    .reverse()
    .map((draft) => ({
      id: `session-${draft.startedAt}`,
      goal: draft.goal,
      startedAt: draft.startedAt,
      endedAt: draft.endedAt,
      rows: draft.rows,
      actions: draft.rows.length - draft.rows.filter(isBlocked).length,
      blocked: draft.rows.filter(isBlocked).length,
      outcome: outcomeOf(draft.rows),
    }))
}

export async function loadSessions(limit = 300): Promise<AuditSession[]> {
  const rows = await db.audit.orderBy('at').reverse().limit(limit).toArray()
  return groupSessions(rows)
}

export function formatWhen(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
