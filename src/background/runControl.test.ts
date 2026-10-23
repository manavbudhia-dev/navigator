import { afterEach, describe, expect, it } from 'vitest'

import { KillSwitch } from '@/safety/killSwitch'

import {
  beginRun,
  endRun,
  hooksFor,
  recordEvent,
  resolveApproval,
  resolveQuestion,
  runStatus,
  stopRun,
  type ActiveRun,
} from './runControl'

import type { AgentHooks } from '@/agent/loop'

/**
 * The run slot and its prompt plumbing (spec §9/§10). These are the pieces that
 * used to strand a task: an approval nobody could answer, or a rejected second
 * start that freed the first run's slot on its way out.
 */

/** A test that fails before its `finally` must not leak the slot into the next one. */
let held: ActiveRun | null = null

afterEach(() => {
  if (held !== null) endRun(held)
  held = null
})

function harness(): { run: ActiveRun; hooks: AgentHooks } {
  const run = beginRun('task')
  held = run
  // The loop emits its own events; these hooks only park the prompts, so the
  // emitter is a no-op here.
  return { run, hooks: hooksFor(() => undefined, run) }
}

function approvalRequest(id: string): Parameters<AgentHooks['requestApproval']>[0] {
  return {
    id,
    tool: 'click',
    args: { index: 3 },
    summary: 'Click Pay now',
    level: 'high',
    reasons: [],
    hardBlock: 'payment',
    host: 'shop.example.test',
  }
}

describe('run slot ownership', () => {
  it('refuses a second run while the browser is busy', () => {
    const run = beginRun('task')
    try {
      expect(() => beginRun('recipe')).toThrow(/task is already running/)
    } finally {
      endRun(run)
    }
  })

  it('ignores a release from a run that does not hold the slot', () => {
    const run = beginRun('task')
    try {
      // The losing `run-task` reaches its cleanup with a run object of its own;
      // releasing must not strand the winner's approvals.
      const stranger: ActiveRun = { label: 'recipe', kill: new KillSwitch(), approvals: new Map(), questions: new Map() }
      expect(() => beginRun('recipe')).toThrow()
      endRun(stranger)
      expect(runStatus().running).toBe(true)
      expect(runStatus().label).toBe('task')
    } finally {
      endRun(run)
    }
  })

  it('releases the slot for the run that holds it', () => {
    const run = beginRun('task')
    endRun(run)
    expect(runStatus().running).toBe(false)
    const next = beginRun('recipe')
    expect(next.label).toBe('recipe')
    endRun(next)
  })
})

describe('parked approvals', () => {
  it('resolves when the panel answers', async () => {
    const { run, hooks } = harness()
    try {
      const pending = hooks.requestApproval(approvalRequest('a1'))
      expect(resolveApproval('a1', true).ok).toBe(true)
      await expect(pending).resolves.toBe(true)
      expect(run.approvals.size).toBe(0)
    } finally {
      endRun(run)
    }
  })

  it('rejects a second reply for the same id instead of hanging', async () => {
    const { run, hooks } = harness()
    try {
      const pending = hooks.requestApproval(approvalRequest('a2'))
      expect(resolveApproval('a2', false).ok).toBe(true)
      expect(resolveApproval('a2', true).ok).toBe(false)
      await expect(pending).resolves.toBe(false)
    } finally {
      endRun(run)
    }
  })

  it('resolves as denied when the run is stopped while parked', async () => {
    const { run, hooks } = harness()
    try {
      const pending = hooks.requestApproval(approvalRequest('a3'))
      expect(stopRun().ok).toBe(true)
      await expect(pending).resolves.toBe(false)
    } finally {
      endRun(run)
    }
  })

  it('settles immediately when the prompt arrives after the run is already stopped', async () => {
    const { run, hooks } = harness()
    try {
      run.kill.stop()
      await expect(hooks.requestApproval(approvalRequest('a4'))).resolves.toBe(false)
    } finally {
      endRun(run)
    }
  })

  it('routes a question answer to the run that asked it', async () => {
    const { run, hooks } = harness()
    try {
      const pending = hooks.askUser('q1', 'Which address?')
      expect(resolveQuestion('q1', 'use the work address').ok).toBe(true)
      await expect(pending).resolves.toBe('use the work address')
      expect(resolveQuestion('q1', 'late').ok).toBe(false)
    } finally {
      endRun(run)
    }
  })

  it('stops a parked question too', async () => {
    const { run, hooks } = harness()
    try {
      const pending = hooks.askUser('q2', 'Which one?')
      stopRun()
      await expect(pending).resolves.toBe('(task stopped)')
    } finally {
      endRun(run)
    }
  })
})

describe('the event log a reopened panel rebuilds from', () => {
  it('keeps live events and reports the run as busy', () => {
    const { run } = harness()
    try {
      recordEvent({ type: 'step', n: 1 })
      recordEvent({ type: 'thinking', text: 'looking' })
      const status = runStatus()
      expect(status.running).toBe(true)
      expect(status.events.map((event) => event.type)).toEqual(['step', 'thinking'])
    } finally {
      endRun(run)
    }
  })

  it('clears a log that already ended, so a finished run is not offered a Stop button', () => {
    const { run } = harness()
    recordEvent({ type: 'step', n: 1 })
    endRun(run)
    recordEvent({
      type: 'done',
      runId: 'r',
      success: true,
      summary: 'ok',
      steps: 1,
      promptTokens: 1,
      completionTokens: 1,
    })
    expect(runStatus().events).toEqual([])
    expect(runStatus().running).toBe(false)
  })

  it('stays bounded no matter how long the run is', () => {
    const { run } = harness()
    try {
      for (let i = 0; i < 500; i++) recordEvent({ type: 'step', n: i })
      const events = runStatus().events
      expect(events).toHaveLength(200)
      expect(events[199]).toEqual({ type: 'step', n: 499 })
    } finally {
      endRun(run)
    }
  })

  it('starts a fresh log with each run', () => {
    const first = beginRun('task')
    recordEvent({ type: 'step', n: 1 })
    endRun(first)
    const second = beginRun('recipe')
    try {
      expect(runStatus().events).toEqual([])
      expect(runStatus().label).toBe('recipe')
    } finally {
      endRun(second)
    }
  })
})
