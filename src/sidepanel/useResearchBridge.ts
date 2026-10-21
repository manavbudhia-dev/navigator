import { useCallback, useEffect, useState } from 'react'

import { latestResearchResult } from '@/research/store'
import {
  isResearchEventMessage,
  type ResearchDepth,
  type ResearchEvent,
  type ResearchResult,
} from '@/research/types'
import { inExtension } from '@/lib/extension'
import type { BackgroundMessage, BackgroundResponse } from '@/types/messages'

/**
 * Side panel bridge to the background research engine: starts and stops runs,
 * replays ResearchEvents as they arrive, and asks follow-up questions of the
 * corpus stored from the last run.
 */

async function send(message: BackgroundMessage): Promise<BackgroundResponse | null> {
  if (!inExtension) return null
  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundResponse
  } catch {
    return null
  }
}

export type FollowupReply = { ok: boolean; answer?: string; error?: string }

export function useResearchBridge() {
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<ResearchEvent[]>([])
  const [result, setResult] = useState<ResearchResult | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    void latestResearchResult()
      .then((stored) => {
        if (stored !== null) setResult(stored)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!inExtension) return
    const listener = (message: unknown): undefined => {
      if (!isResearchEventMessage(message)) return undefined
      const event = message.event
      setEvents((prev) => [...prev.slice(-199), event])
      if (event.type === 'done') {
        setResult(event.result)
        setRunning(false)
      } else if (event.type === 'failed') {
        setFailure(event.error)
        setRunning(false)
      }
      return undefined
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const run = useCallback(async (question: string, depth: ResearchDepth): Promise<boolean> => {
    setEvents([])
    setStartError(null)
    setFailure(null)
    const response = await send({ kind: 'run-research', question, depth })
    if (response && response.ok && 'accepted' in response) {
      if (response.accepted) {
        setRunning(true)
        return true
      }
      setStartError(response.error ?? 'The research run was rejected.')
      return false
    }
    if (response && !response.ok) {
      setStartError(response.error)
      return false
    }
    setStartError('Not running inside Chrome, or the extension needs a reload.')
    return false
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    await send({ kind: 'stop-research' })
    setRunning(false)
  }, [])

  const ask = useCallback(async (runId: string, question: string): Promise<FollowupReply> => {
    const response = await send({ kind: 'research-followup', runId, question })
    if (response === null) return { ok: false, error: 'Not running inside Chrome.' }
    if (response.ok && 'answer' in response) return { ok: true, answer: response.answer }
    if (!response.ok) return { ok: false, error: response.error }
    return { ok: false, error: 'The background returned an unexpected reply.' }
  }, [])

  const clear = useCallback((): void => {
    setEvents([])
    setStartError(null)
    setFailure(null)
  }, [])

  /** Re-open a stored run — or blank the panel — without touching the pipeline. */
  const show = useCallback((value: ResearchResult | null): void => {
    setResult(value)
    setEvents([])
    setStartError(null)
    setFailure(null)
  }, [])

  return { running, events, result, startError, failure, run, stop, ask, clear, show }
}
