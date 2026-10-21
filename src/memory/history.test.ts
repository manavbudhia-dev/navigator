import { describe, expect, it } from 'vitest'

import { formatWhen, groupSessions, type AuditSession } from './history'
import type { AuditRow } from './db'

const MINUTE = 60 * 1000

function row(overrides: Partial<AuditRow> & Pick<AuditRow, 'at' | 'goal' | 'tool'>): AuditRow {
  return {
    id: overrides.at,
    args: {},
    risk: 'safe',
    hardBlock: null,
    decision: 'allow',
    ok: true,
    detail: '',
    ...overrides,
  }
}

function titles(sessions: AuditSession[]): string[] {
  return sessions.map((session) => session.goal)
}

describe('groupSessions', () => {
  it('returns nothing for an empty log', () => {
    expect(groupSessions([])).toEqual([])
  })

  it('merges consecutive rows of the same goal into one session', () => {
    const sessions = groupSessions([
      row({ at: 0, goal: 'buy tickets', tool: 'read_page' }),
      row({ at: MINUTE, goal: 'buy tickets', tool: 'click' }),
      row({ at: 2 * MINUTE, goal: 'buy tickets', tool: 'finish' }),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      goal: 'buy tickets',
      startedAt: 0,
      endedAt: 2 * MINUTE,
      actions: 3,
      blocked: 0,
      outcome: 'success',
    })
  })

  it('starts a new session when the goal changes', () => {
    const sessions = groupSessions([
      row({ at: 0, goal: 'first', tool: 'click' }),
      row({ at: MINUTE, goal: 'second', tool: 'click' }),
    ])
    expect(titles(sessions)).toEqual(['second', 'first'])
  })

  it('splits a long-running goal into separate sessions', () => {
    const sessions = groupSessions([
      row({ at: 0, goal: 'same', tool: 'click' }),
      row({ at: 31 * MINUTE, goal: 'same', tool: 'click' }),
    ])
    expect(sessions).toHaveLength(2)
  })

  it('keeps two runs of the same goal in separate sessions', () => {
    const sessions = groupSessions([
      row({ at: 0, goal: 'renew passport', tool: 'click', runId: 'a' }),
      row({ at: MINUTE, goal: 'renew passport', tool: 'finish', runId: 'a' }),
      row({ at: 2 * MINUTE, goal: 'renew passport', tool: 'click', runId: 'b' }),
    ])
    expect(sessions).toHaveLength(2)
    expect(sessions.map((session) => session.runId)).toEqual(['b', 'a'])
    expect(sessions[1]!.id).toBe('run-a')
  })

  it('trusts the run id over the time gap, because a slow run is still one run', () => {
    const sessions = groupSessions([
      row({ at: 0, goal: 'slow site', tool: 'click', runId: 'a' }),
      row({ at: 90 * MINUTE, goal: 'slow site', tool: 'finish', runId: 'a' }),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.actions).toBe(2)
  })

  it('falls back to goal plus time gap for rows with no run id', () => {
    const sessions = groupSessions([
      row({ at: 0, goal: 'legacy', tool: 'click' }),
      row({ at: MINUTE, goal: 'legacy', tool: 'finish' }),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.runId).toBeNull()
  })

  it('orders sessions newest first even when rows arrive shuffled', () => {
    const sessions = groupSessions([
      row({ at: 3 * MINUTE, goal: 'later', tool: 'finish' }),
      row({ at: 0, goal: 'earlier', tool: 'click' }),
      row({ at: 1, goal: 'earlier', tool: 'finish' }),
    ])
    expect(titles(sessions)).toEqual(['later', 'earlier'])
    expect(sessions[1]!.rows.map((r) => r.at)).toEqual([0, 1])
  })

  it('reads the outcome from the last finish row', () => {
    const failed = groupSessions([
      row({ at: 0, goal: 'g', tool: 'read_page' }),
      row({ at: 1, goal: 'g', tool: 'finish', ok: false, detail: 'gave up' }),
    ])
    expect(failed[0]!.outcome).toBe('failed')

    const stopped = groupSessions([
      row({ at: 0, goal: 'g', tool: 'click', decision: 'block', ok: false }),
    ])
    expect(stopped[0]).toMatchObject({ outcome: 'stopped', actions: 0, blocked: 1 })

    const running = groupSessions([row({ at: 0, goal: 'g', tool: 'read_page' })])
    expect(running[0]!.outcome).toBe('unknown')
  })
})

describe('formatWhen', () => {
  const now = 1_700_000_000_000

  it('uses human units that grow with the age', () => {
    expect(formatWhen(now, now)).toBe('just now')
    expect(formatWhen(now - 4 * MINUTE, now)).toBe('4 min ago')
    expect(formatWhen(now - 3 * 60 * MINUTE, now)).toBe('3 h ago')
    const older = now - 50 * 60 * MINUTE
    expect(formatWhen(older, now)).toBe(
      new Date(older).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    )
  })
})
