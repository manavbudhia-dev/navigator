import { describe, expect, it } from 'vitest'

import { backfillEvents } from './hydrate'

import type { TaskEvent } from '@/types/task'

function action(id: string, tool = 'click'): TaskEvent {
  return { type: 'action', id, tool, args: { index: 1 }, summary: `click ${tool}` }
}

describe('backfillEvents', () => {
  it('puts the replayed log in front of what the panel already saw', () => {
    const logged = [action('a'), action('b')]
    const live = [action('c')]
    expect(backfillEvents(logged, live).map((event) => (event.type === 'action' ? event.id : ''))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('does not list an event that reached us both live and from the log', () => {
    const shared = action('a')
    expect(backfillEvents([shared], [shared, action('b')])).toEqual([shared, action('b')])
  })

  it('keeps the newest events when the merged run is longer than the timeline', () => {
    const logged = Array.from({ length: 200 }, (_, i) => action(`l${i}`))
    const live = [action('x'), action('y')]
    const merged = backfillEvents(logged, live)
    expect(merged).toHaveLength(200)
    expect(merged[merged.length - 1]).toEqual(action('y'))
    expect(merged.some((event) => event.type === 'action' && event.id === 'l0')).toBe(false)
  })

  it('is a no-op when the worker has nothing to replay', () => {
    const live = [action('a')]
    expect(backfillEvents([], live)).toEqual(live)
  })
})
