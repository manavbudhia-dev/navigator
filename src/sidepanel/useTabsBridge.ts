import { useCallback, useEffect, useState } from 'react'

import { inExtension } from '@/lib/extension'
import { savedSessions } from '@/tabs/store'
import type { SavedSession, TabIntent, TabReport } from '@/tabs/types'
import type { BackgroundMessage, BackgroundResponse } from '@/types/messages'

/**
 * Side panel bridge to the tab manager (spec §8). The manager lives in the
 * service worker because the 60-second undo buffer must have exactly one owner;
 * the panel therefore never touches `chrome.tabs` for state, it asks and the
 * report comes back with a fresh snapshot of every open tab.
 */

async function send(message: BackgroundMessage): Promise<BackgroundResponse | null> {
  if (!inExtension) return null
  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundResponse
  } catch {
    return null
  }
}

export function useTabsBridge() {
  const [report, setReport] = useState<TabReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SavedSession[]>([])
  const [secondsLeft, setSecondsLeft] = useState(0)

  const reloadSessions = useCallback(() => {
    savedSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
  }, [])

  useEffect(() => {
    reloadSessions()
  }, [reloadSessions])

  const undoExpiresAt = report?.undo?.expiresAt
  useEffect(() => {
    if (undoExpiresAt === undefined) {
      setSecondsLeft(0)
      return
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((undoExpiresAt - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [undoExpiresAt])

  const apply = useCallback(
    (next: TabReport): void => {
      setReport(next)
      // A refused operation is part of the report, and the report card shows it.
      // `error` here is only for a reply that never made it back.
      setError(null)
      if (next.intent === 'save' || next.intent === 'restore' || next.intent === 'sessions') {
        reloadSessions()
      }
    },
    [reloadSessions],
  )

  /** Free-text command, parsed by the manager's rule engine (then the model). */
  const run = useCallback(async (text: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const response = await send({ kind: 'tab-command', text })
    setBusy(false)
    if (response === null) {
      setError('Not running inside Chrome, or the extension needs a reload.')
      return
    }
    if (response.ok && 'report' in response) {
      apply(response.report)
      return
    }
    if (!response.ok) setError(response.error)
    else setError('The background returned an unexpected reply.')
  }, [apply])

  /** A button press: no parsing needed, we already know the intent. */
  const intent = useCallback(async (value: TabIntent): Promise<void> => {
    setBusy(true)
    setError(null)
    const response = await send({ kind: 'tab-intent', intent: value })
    setBusy(false)
    if (response === null) {
      setError('Not running inside Chrome, or the extension needs a reload.')
      return
    }
    if (response.ok && 'report' in response) {
      apply(response.report)
      return
    }
    if (!response.ok) setError(response.error)
    else setError('The background returned an unexpected reply.')
  }, [apply])

  const clear = useCallback((): void => {
    setReport(null)
    setError(null)
  }, [])

  return {
    report,
    tabs: report?.tabs ?? [],
    sessions,
    busy,
    error,
    secondsLeft,
    run,
    intent,
    clear,
    reloadSessions,
  }
}
