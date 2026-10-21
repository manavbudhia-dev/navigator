import { describe, expect, it } from 'vitest'

import { UndoBuffer, type ClosedSnapshot } from './undo'

const TTL = 60_000

function snap(id: number, overrides: Partial<ClosedSnapshot> = {}): ClosedSnapshot {
  return {
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    windowId: 1,
    index: id,
    pinned: false,
    ...overrides,
  }
}

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let at = start
  return { now: () => at, advance: (ms) => (at += ms) }
}

describe('UndoBuffer', () => {
  it('is empty until something is closed', () => {
    const buffer = new UndoBuffer(TTL, () => 0)
    expect(buffer.state()).toBeNull()
    expect(buffer.take()).toBeNull()
  })

  it('records a bulk close as one undoable frame', () => {
    const buffer = new UndoBuffer(TTL, () => 5_000)
    buffer.record([snap(1), snap(2), snap(3)])
    expect(buffer.state()).toEqual({ tabs: 3, expiresAt: 65_000 })
    expect(buffer.take()).toHaveLength(3)
    expect(buffer.take()).toBeNull()
  })

  it('ignores an empty record', () => {
    const buffer = new UndoBuffer(TTL, () => 0)
    buffer.record([])
    expect(buffer.state()).toBeNull()
  })

  it('accumulates a second bulk op inside the same window', () => {
    const { now, advance } = clock()
    const buffer = new UndoBuffer(TTL, now)
    buffer.record([snap(1)])
    advance(20_000)
    buffer.record([snap(2)])
    expect(buffer.state()!.tabs).toBe(2)
    // The deadline stays with the first close: we never resurrect after the user moved on.
    expect(buffer.state()!.expiresAt).toBe(1_060_000)
  })

  it('drops a duplicate of the same URL in the same window', () => {
    const buffer = new UndoBuffer(TTL, () => 0)
    buffer.record([snap(1), snap(1, { title: 'Same page, twice' }), snap(1, { windowId: 2 })])
    expect(buffer.state()!.tabs).toBe(2)
  })

  it('expires 60 seconds after the close', () => {
    const { now, advance } = clock()
    const buffer = new UndoBuffer(TTL, now)
    buffer.record([snap(1)])
    expect(buffer.secondsLeft(now())).toBe(60)
    advance(59_000)
    expect(buffer.secondsLeft(now())).toBe(1)
    advance(2_000)
    expect(buffer.secondsLeft(now())).toBe(0)
    expect(buffer.state()).toBeNull()
    expect(buffer.take()).toBeNull()
  })

  it('clears on demand', () => {
    const buffer = new UndoBuffer(TTL, () => 0)
    buffer.record([snap(1)])
    buffer.clear()
    expect(buffer.state()).toBeNull()
  })
})
