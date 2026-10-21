import type { ActResult } from '@/types/actions'

/**
 * Waiting inside the page (spec §4 `wait_for`, §5 "DOM stability"). The
 * background cannot observe a document it does not own, so these three
 * conditions are answered by the content script that is already in there.
 */

export type WaitCondition = 'selector' | 'text' | 'quiet'

const POLL_MS = 100
/** How long the DOM must stay still before "quiet" counts as settled (spec §5). */
export const QUIET_MS = 500

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function visible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0'
}

function settled(condition: WaitCondition, value: string): boolean {
  if (condition === 'selector') {
    try {
      const found = document.querySelector(value)
      return found !== null && visible(found)
    } catch {
      return false
    }
  }
  if (condition === 'text') return (document.body?.innerText ?? '').includes(value)
  return true
}

/** Resolves as soon as the page goes quiet, or reports what it never saw. */
function untilQuiet(quietMs: number, deadline: number): Promise<boolean> {
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let done = false

    const observer = new MutationObserver(restartQuietClock)

    function finish(quiet: boolean): void {
      if (done) return
      done = true
      if (quietTimer !== undefined) clearTimeout(quietTimer)
      if (pollTimer !== undefined) clearInterval(pollTimer)
      observer.disconnect()
      resolve(quiet)
    }

    function restartQuietClock(): void {
      if (quietTimer !== undefined) clearTimeout(quietTimer)
      quietTimer = setTimeout(() => finish(true), quietMs)
    }

    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    restartQuietClock()

    // A page that stopped mutating before we attached still has to time out.
    pollTimer = setInterval(() => {
      if (Date.now() >= deadline) finish(false)
    }, POLL_MS)
  })
}

export async function waitForInPage(
  condition: WaitCondition,
  value: string,
  timeoutMs: number,
): Promise<ActResult> {
  if (condition === 'quiet') {
    const quiet = await untilQuiet(QUIET_MS, Date.now() + timeoutMs)
    return quiet
      ? { ok: true, detail: `The page stopped changing after ${QUIET_MS}ms of quiet.` }
      : { ok: false, error: `The page was still mutating after ${timeoutMs}ms.` }
  }

  if (condition === 'selector') {
    // A typo would otherwise look like a control that never arrives.
    try {
      document.querySelector(value)
    } catch {
      return { ok: false, error: `"${value}" is not a valid CSS selector.` }
    }
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (settled(condition, value)) {
      return { ok: true, detail: `Found ${condition} "${value}".` }
    }
    await delay(POLL_MS)
  }
  return { ok: false, error: `Timed out after ${timeoutMs}ms waiting for ${condition} "${value}".` }
}
