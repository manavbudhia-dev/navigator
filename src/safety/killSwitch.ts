/**
 * Kill switch (spec §9): one button, one flag. Every long-running await in
 * the agent loop passes this signal, so stopping is immediate rather than
 * "after the current step finishes".
 */
export class KillSwitch {
  private controller = new AbortController()
  private stopped = false

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get isStopped(): boolean {
    return this.stopped
  }

  stop(): void {
    this.stopped = true
    this.controller.abort(new Error('Navigator was stopped by the user.'))
  }

  reset(): void {
    this.stopped = false
    this.controller = new AbortController()
  }

  /** Throws if the switch is tripped — call between steps. */
  check(): void {
    if (this.stopped) throw new Error('Navigator was stopped by the user.')
  }
}
