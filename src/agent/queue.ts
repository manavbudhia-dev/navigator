/**
 * Serialized action queue: the agent never performs two browser actions at
 * once (they mutate the same DOM), and queued actions can be dropped when
 * the kill switch trips. One action = one enqueued task.
 */
export class ActionQueue {
  private running = false
  private readonly pending: Array<{
    task: () => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  }> = []

  get size(): number {
    return this.pending.length
  }

  get busy(): boolean {
    return this.running
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ task, resolve: resolve as (value: unknown) => void, reject })
      void this.drain()
    })
  }

  /** Drop everything not yet started. Returns how many were cancelled. */
  cancelPending(reason = 'Cancelled before execution.'): number {
    const cancelled = this.pending.splice(0)
    for (const item of cancelled) item.reject(new Error(reason))
    return cancelled.length
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()
        if (!item) continue
        try {
          item.resolve(await item.task())
        } catch (error) {
          item.reject(error)
        }
      }
    } finally {
      this.running = false
    }
  }
}
