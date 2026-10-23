import type { TaskEvent } from '@/types/task'

/** The timeline never grows past this, in the panel or in the worker's log. */
const TIMELINE_LIMIT = 200

/**
 * Put the worker's replayed log in front of whatever the live listener already
 * delivered while the status request was in flight.
 *
 * The panel used to clear its events and replay from scratch, which silently
 * dropped anything that arrived between the two: an approval raised in that
 * window left the agent waiting for an answer no one could see. Merging keeps
 * both, and an event that reached us twice — once live, once from the log —
 * appears once.
 */
export function backfillEvents(logged: readonly TaskEvent[], live: readonly TaskEvent[]): TaskEvent[] {
  const seen = new Set(logged.map((event) => JSON.stringify(event)))
  const fresh = live.filter((event) => !seen.has(JSON.stringify(event)))
  return [...logged, ...fresh].slice(-TIMELINE_LIMIT)
}
