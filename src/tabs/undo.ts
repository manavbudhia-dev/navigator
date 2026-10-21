import type { UndoState } from './types'
import { UNDO_WINDOW_MS } from './types'

/**
 * Undo buffer (spec §8: "bulk ops with 1-click UNDO, keep closed-tab snapshot
 * for 60s"). Only the *identity* of a closed tab is kept — url, position, pin
 * state — which is all Chrome's session-less API can reopen.
 *
 * Bulk operations that land inside the same window accumulate into one
 * snapshot, so a mis-clicked "close all" followed by "merge duplicates" is
 * still a single UNDO. The buffer expires with the earliest close: we never
 * resurrect something after the user has moved on.
 */

export interface ClosedSnapshot {
  url: string
  title: string
  windowId: number
  index: number
  pinned: boolean
}

interface Frame {
  tabs: ClosedSnapshot[]
  expiresAt: number
}

export class UndoBuffer {
  private frame: Frame | null = null

  constructor(
    private readonly ttlMs: number = UNDO_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  record(closed: readonly ClosedSnapshot[]): void {
    if (closed.length === 0) return
    const at = this.now()
    const existing = this.frame !== null && this.frame.expiresAt > at ? this.frame : null
    const merged = [...(existing?.tabs ?? []), ...closed]
    this.frame = {
      tabs: dedupe(merged),
      expiresAt: existing === null ? at + this.ttlMs : existing.expiresAt,
    }
  }

  state(): UndoState | null {
    const frame = this.takeIfLive()
    if (frame === null) return null
    return { tabs: frame.tabs.length, expiresAt: frame.expiresAt }
  }

  secondsLeft(now = this.now()): number {
    const frame = this.frame
    if (frame === null || frame.expiresAt <= now) return 0
    return Math.max(0, Math.ceil((frame.expiresAt - now) / 1000))
  }

  /** Drains the buffer: a second UNDO must not reopen the same tabs twice. */
  take(): ClosedSnapshot[] | null {
    const frame = this.takeIfLive()
    if (frame === null) return null
    this.frame = null
    return frame.tabs
  }

  clear(): void {
    this.frame = null
  }

  private takeIfLive(): Frame | null {
    if (this.frame === null) return null
    if (this.frame.expiresAt <= this.now()) {
      this.frame = null
      return null
    }
    return this.frame
  }
}

function dedupe(tabs: readonly ClosedSnapshot[]): ClosedSnapshot[] {
  const seen = new Set<string>()
  const out: ClosedSnapshot[] = []
  for (const tab of tabs) {
    const key = `${tab.windowId}|${tab.url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tab)
  }
  return out
}
