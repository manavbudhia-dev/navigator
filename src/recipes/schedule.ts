import type { RecipeSchedule } from './types'

/**
 * When the next scheduled run is due (spec §11c). `chrome.alarms` wants a delay
 * rather than a wall-clock time, so the schedule is turned into "milliseconds
 * from now" — and Chrome floors the delay at one minute, which the caller
 * applies.
 */

const MINUTE_MS = 60_000

/** The first slot at or after `from + 1 minute`, so a save never fires instantly. */
export function nextSlot(schedule: RecipeSchedule, from = Date.now()): number {
  const soonest = from + MINUTE_MS
  const next = new Date(soonest)
  next.setHours(schedule.hour, schedule.minute, 0, 0)
  if (next.getTime() < soonest) next.setDate(next.getDate() + 1)
  if (schedule.frequency === 'weekly') {
    const wanted = schedule.dayOfWeek ?? next.getDay()
    while (next.getDay() !== wanted) next.setDate(next.getDate() + 1)
  }
  return next.getTime() - from
}

/** Chrome's own floor for `periodInMinutes`. */
export function periodInMinutes(schedule: RecipeSchedule): number {
  return schedule.frequency === 'daily' ? 1440 : 10_080
}
