import { describe, expect, it } from 'vitest'

import { nextSlot, periodInMinutes } from './schedule'
import type { RecipeSchedule } from './types'

/** Local-time fixtures: the schedule is wall-clock, so UTC would be a lie. */
function at(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function daily(hour: number, minute = 0): RecipeSchedule {
  return { frequency: 'daily', hour, minute, dayOfWeek: null }
}

function weekly(hour: number, minute: number, dayOfWeek: number): RecipeSchedule {
  return { frequency: 'weekly', hour, minute, dayOfWeek }
}

describe('nextSlot', () => {
  it('waits for today’s time when it has not passed yet', () => {
    const from = at(2026, 10, 20, 8, 0)
    expect(nextSlot(daily(17, 30), from)).toBe(at(2026, 10, 20, 17, 30) - from)
  })

  it('rolls over to tomorrow once today’s time has gone', () => {
    const from = at(2026, 10, 20, 18, 0)
    expect(nextSlot(daily(9), from)).toBe(at(2026, 10, 21, 9, 0) - from)
  })

  it('never promises less than the minute Chrome allows', () => {
    const from = at(2026, 10, 20, 9, 0)
    expect(nextSlot(daily(9, 0), from)).toBeGreaterThanOrEqual(60_000)
    expect(nextSlot(daily(9, 0), from)).toBe(at(2026, 10, 21, 9, 0) - from)
  })

  it('lands on the requested weekday when weekly', () => {
    // 2026-10-20 is a Tuesday.
    const from = at(2026, 10, 20, 8, 0)
    const delay = nextSlot(weekly(6, 0, 0), from)
    const when = new Date(from + delay)
    expect(when.getDay()).toBe(0)
    expect(when.getHours()).toBe(6)
    expect(delay).toBeLessThanOrEqual(7 * 24 * 60 * 60_000)
  })

  it('takes the next matching weekday when today’s slot has gone', () => {
    // 2026-10-20 is a Tuesday.
    const from = at(2026, 10, 20, 18, 0)
    // Tuesday 20:00 is still ahead, so today is the match.
    expect(nextSlot(weekly(20, 0, 2), from)).toBe(at(2026, 10, 20, 20, 0) - from)
    // Monday 20:00 has to wait six days.
    expect(nextSlot(weekly(20, 0, 1), from)).toBe(at(2026, 10, 26, 20, 0) - from)
  })

  it('falls back to the current weekday when a weekly plan has no day', () => {
    const from = at(2026, 10, 20, 8, 0)
    const schedule: RecipeSchedule = { frequency: 'weekly', hour: 8, minute: 30, dayOfWeek: null }
    expect(nextSlot(schedule, from)).toBe(at(2026, 10, 20, 8, 30) - from)
  })
})

describe('periodInMinutes', () => {
  it('is one day for daily and one week for weekly', () => {
    expect(periodInMinutes(daily(9))).toBe(1440)
    expect(periodInMinutes(weekly(9, 0, 1))).toBe(10_080)
  })
})
