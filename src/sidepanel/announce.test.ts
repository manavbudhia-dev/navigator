import { describe, expect, it } from 'vitest'

import { announceEvent, latestAnnouncement } from './announce'
import type { TaskEvent } from '@/types/task'

/**
 * Batch 11c (spec §10): what the screen reader says. One event, one sentence —
 * and silence for the ones that would only repeat something already said.
 */

const EVENTS: TaskEvent[] = [
  { type: 'started', goal: 'book two seats', mode: 'copilot' },
  { type: 'step', n: 3 },
  { type: 'thinking', text: 'let me look at the seat map first' },
  { type: 'action', id: 'a1', tool: 'click', args: {}, summary: 'click Seat class' },
  {
    type: 'approval',
    id: 'a1',
    tool: 'click',
    args: {},
    summary: 'click Proceed to payment',
    level: 'high',
    reasons: ['payment'],
    hardBlock: 'payment',
  },
  { type: 'approval-resolved', id: 'a1', approved: false },
  { type: 'question', id: 'q1', question: 'Which seat class?' },
  { type: 'question-resolved', id: 'q1' },
  { type: 'result', tool: 'click', ok: false, content: 'element went stale' },
  { type: 'blocked', tool: 'fill_form', reason: 'the vault is locked' },
  { type: 'note', text: 'the page reloaded on its own' },
  { type: 'recipe', id: 'r1', name: 'Book seats', ok: true, detail: '6 steps, 1 healed', healed: 1 },
  {
    type: 'done',
    runId: 'run-1',
    success: true,
    summary: 'two window seats held',
    steps: 7,
    promptTokens: 100,
    completionTokens: 20,
  },
  { type: 'failed', error: 'the model refused' },
]

describe('announceEvent', () => {
  it('says something for every event but the two that echo', () => {
    const spoken = EVENTS.map((event) => announceEvent(event))
    expect(spoken.filter((text) => text !== null)).toHaveLength(EVENTS.length - 2)
  })

  it('keeps the model draft and the answered question quiet', () => {
    expect(announceEvent({ type: 'thinking', text: 'hmm' })).toBeNull()
    expect(announceEvent({ type: 'question-resolved', id: 'q1' })).toBeNull()
  })

  it('names the risk and the outcome of an approval', () => {
    expect(announceEvent({ type: 'approval-resolved', id: 'a1', approved: true })).toBe('Approved.')
    expect(announceEvent({ type: 'approval-resolved', id: 'a1', approved: false })).toBe('Denied.')
  })

  it('reads a waiting approval as a request for the user', () => {
    const waiting = EVENTS.find((event) => event.type === 'approval')!
    expect(announceEvent(waiting)).toMatch(/Waiting for your approval.*Risk: high/s)
  })

  it('reports a failure as a failure', () => {
    expect(announceEvent(EVENTS[8]!)).toBe('click failed: element went stale')
    expect(announceEvent(EVENTS[13]!)).toBe('Task failed: the model refused')
  })

  it('finishes with the outcome and its summary', () => {
    expect(announceEvent(EVENTS[12]!)).toBe('Task finished: two window seats held')
  })

  it('clips a result too long to listen to', () => {
    const long: TaskEvent = { type: 'result', tool: 'read_page', ok: true, content: 'x'.repeat(500) }
    const text = announceEvent(long) ?? ''
    expect(text.length).toBeLessThan(260)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('latestAnnouncement', () => {
  it('holds the last thing worth saying', () => {
    expect(latestAnnouncement(EVENTS.slice(0, 4))).toBe('Running: click Seat class.')
  })

  it('skips over the silent events at the end', () => {
    expect(latestAnnouncement([...EVENTS.slice(0, 3), { type: 'thinking', text: '…' }])).toBe('Step 3.')
  })

  it('says nothing before a task has started', () => {
    expect(latestAnnouncement([])).toBe('')
  })
})
