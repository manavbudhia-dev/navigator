import { KillSwitch } from '@/safety/killSwitch'

import type { AgentHooks } from '@/agent/loop'
import type { TaskEvent } from '@/types/task'

/**
 * The single run the service worker owns at a time — a task from the Agent tab
 * or a replayed recipe. Approvals and answers are matched by id, so the side
 * panel can reply to whichever one asked, and Stop always means "the thing that
 * is going right now".
 */

export interface ActiveRun {
  label: string
  kill: KillSwitch
  approvals: Map<string, (approved: boolean) => void>
  questions: Map<string, (answer: string) => void>
}

let active: ActiveRun | null = null

/**
 * The panel is a document that comes and goes; the run is not. Every event is
 * kept here (bounded) so a panel that opens onto a live task can rebuild the
 * timeline and the pending approval card instead of showing an idle UI over a
 * running agent.
 */
const eventLog: TaskEvent[] = []
const EVENT_LOG_LIMIT = 200

export function isRunActive(): boolean {
  return active !== null
}

export function runLabel(): string {
  return active?.label ?? 'nothing'
}

/** Throws when something else already owns the browser. */
export function beginRun(label: string): ActiveRun {
  if (active !== null) throw new Error(`A ${active.label} is already running. Stop it first.`)
  active = { label, kill: new KillSwitch(), approvals: new Map(), questions: new Map() }
  eventLog.length = 0
  return active
}

/**
 * Releases the slot, but only for the run that holds it. Without the owner
 * check, a second `run-task` that was rejected by `beginRun` would clear the
 * first run's state on its way out and leave its approvals unreachable.
 */
export function endRun(owner: ActiveRun): void {
  if (active === owner) active = null
}

export function recordEvent(event: TaskEvent): void {
  eventLog.push(event)
  if (eventLog.length > EVENT_LOG_LIMIT) eventLog.shift()
}

/** What a panel needs to know when it mounts in the middle of a run. */
export function runStatus(): { running: boolean; label: string; events: TaskEvent[] } {
  // A run that already finished belongs to History, not to a live timeline:
  // replaying its log would offer a Stop button for something already stopped.
  const last = eventLog[eventLog.length - 1]
  if (last !== undefined && (last.type === 'done' || last.type === 'failed')) eventLog.length = 0
  return { running: active !== null, label: runLabel(), events: [...eventLog] }
}

export function stopRun(): { ok: boolean; error?: string } {
  if (!active) return { ok: false, error: 'Nothing is running.' }
  active.kill.stop()
  // Tripping the switch already settles each parked prompt as "no" through its
  // abort listener; this is the same call for a run whose signal someone else
  // holds. Both paths delete their own map entry, so a repeat is a no-op.
  for (const settle of [...active.approvals.values()]) settle(false)
  for (const settle of [...active.questions.values()]) settle('(task stopped)')
  return { ok: true }
}

/**
 * Hands an answer to the prompt with that id. The settle function removes its
 * own entry — deleting here first would make it think nobody was waiting and
 * leave the run parked forever.
 */
export function resolveApproval(id: string, approved: boolean): { ok: boolean; error?: string } {
  const settle = active?.approvals.get(id)
  if (!settle) return { ok: false, error: 'No pending approval with that id.' }
  settle(approved)
  return { ok: true }
}

export function resolveQuestion(id: string, answer: string): { ok: boolean; error?: string } {
  const settle = active?.questions.get(id)
  if (!settle) return { ok: false, error: 'No pending question with that id.' }
  settle(answer)
  return { ok: true }
}

/**
 * Parks a prompt until the panel answers it. The promise must always be able
 * to settle: a prompt registered after Stop, or answered twice, used to hang
 * the run forever and hold the single run slot with it. So the entry is keyed
 * on the map, removed by whoever settles it, and the kill signal resolves it
 * as "no" — failing closed, because silence is not consent.
 */
function park<T>(
  pending: Map<string, (value: T) => void>,
  signal: AbortSignal,
  id: string,
  stoppedValue: T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    function settle(value: T): void {
      if (!pending.delete(id)) return
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    function onAbort(): void {
      settle(stoppedValue)
    }
    pending.set(id, settle)
    if (signal.aborted) {
      settle(stoppedValue)
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * The loop's human-in-the-loop channel, wired to *this* run rather than to
 * whichever run happens to own the slot when the prompt arrives. The loop
 * emits the `approval` / `question` events itself; these only park the promise
 * until the side panel answers.
 */
export function hooksFor(emit: (event: TaskEvent) => void, run: ActiveRun): AgentHooks {
  return {
    emit,
    requestApproval: (request) => park(run.approvals, run.kill.signal, request.id, false),
    askUser: (id) => park(run.questions, run.kill.signal, id, '(task stopped)'),
  }
}
