import type { TaskEvent } from '@/types/task'

/**
 * One plain sentence per step, for the ARIA live region (spec §10). The
 * timeline is deliberately terse — "→ click 2", "✓ did click" — which reads as
 * noise out loud, so each event gets a full sentence instead. Events that
 * repeat something already said return null rather than speak twice.
 */
export function announceEvent(event: TaskEvent): string | null {
  switch (event.type) {
    case 'started':
      return `Task started: ${event.goal}. Mode: ${event.mode}.`
    case 'step':
      return `Step ${event.n}.`
    case 'action':
      return `Running: ${event.summary}.`
    case 'approval':
      return `Waiting for your approval: ${event.summary}. Risk: ${event.level}.`
    case 'question':
      return `Navigator is asking: ${event.question}`
    case 'approval-resolved':
      return event.approved ? 'Approved.' : 'Denied.'
    case 'result':
      return `${event.tool} ${event.ok ? 'finished' : 'failed'}: ${clip(event.content)}`
    case 'blocked':
      return `Blocked ${event.tool}: ${event.reason}`
    case 'note':
      return event.text
    case 'recipe':
      return `Recipe ${event.name} ${event.ok ? 'replayed' : 'failed'}: ${event.detail}`
    case 'done':
      return `${event.success ? 'Task finished' : 'Task failed'}: ${event.summary}`
    case 'failed':
      return `Task failed: ${event.error}`
    case 'thinking':
      return null
    case 'question-resolved':
      return null
  }
}

/** What the live region holds: the last thing worth saying. */
export function latestAnnouncement(events: readonly TaskEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const text = announceEvent(events[index]!)
    if (text !== null) return text
  }
  return ''
}

function clip(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
