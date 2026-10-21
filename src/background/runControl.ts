import { KillSwitch } from '@/safety/killSwitch'

import type { AgentHooks } from '@/agent/loop'
import type { TaskEvent } from '@/types/task'

/**
 * The single run the service worker owns at a time — a task from the Agent tab
 * or a replayed recipe. Approvals and answers are matched by id, so the side
 * panel can reply to whichever one asked, and Stop always means "the thing that
 * is going right now".
 */

interface ActiveRun {
  label: string
  kill: KillSwitch
  approvals: Map<string, (approved: boolean) => void>
  questions: Map<string, (answer: string) => void>
}

let active: ActiveRun | null = null

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
  return active
}

export function endRun(): void {
  active = null
}

export function stopRun(): { ok: boolean; error?: string } {
  if (!active) return { ok: false, error: 'Nothing is running.' }
  active.kill.stop()
  for (const resolve of active.approvals.values()) resolve(false)
  for (const resolve of active.questions.values()) resolve('(task stopped)')
  active.approvals.clear()
  active.questions.clear()
  return { ok: true }
}

export function resolveApproval(id: string, approved: boolean): { ok: boolean; error?: string } {
  const resolve = active?.approvals.get(id)
  if (!resolve) return { ok: false, error: 'No pending approval with that id.' }
  active?.approvals.delete(id)
  resolve(approved)
  return { ok: true }
}

export function resolveQuestion(id: string, answer: string): { ok: boolean; error?: string } {
  const resolve = active?.questions.get(id)
  if (!resolve) return { ok: false, error: 'No pending question with that id.' }
  active?.questions.delete(id)
  resolve(answer)
  return { ok: true }
}

/**
 * The loop's human-in-the-loop channel, wired to this run. The loop emits the
 * `approval` / `question` events itself; these only park the promise until the
 * side panel answers.
 */
export function hooksFor(emit: (event: TaskEvent) => void): AgentHooks {
  return {
    emit,
    requestApproval: (request) =>
      new Promise<boolean>((resolve) => {
        active?.approvals.set(request.id, resolve)
      }),
    askUser: (id, question) => {
      void question
      return new Promise<string>((resolve) => {
        active?.questions.set(id, resolve)
      })
    },
  }
}
