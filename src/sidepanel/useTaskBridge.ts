import { useCallback, useEffect, useState } from 'react'

import { inExtension } from '@/lib/extension'
import { isTaskEventMessage, type TaskEvent } from '@/types/task'

import { backfillEvents } from './hydrate'
import type { AgentMode } from '@/types/agent'
import type { BackgroundMessage, BackgroundResponse } from '@/types/messages'

/**
 * Side panel bridge to the background task manager: sends run/stop/approve/
 * answer commands and keeps a replayable list of TaskEvents in state.
 */
export interface PendingApproval {
  id: string
  summary: string
  tool: string
  level: string
  reasons: string[]
  hardBlock: string | null
}

export interface PendingQuestion {
  id: string
  question: string
}

async function send(message: BackgroundMessage): Promise<BackgroundResponse | null> {
  if (!inExtension) return null
  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundResponse
  } catch {
    return null
  }
}

/** Why an answer did not land, in the user's terms rather than the worker's. */
function answerFailure(response: BackgroundResponse | null): string | null {
  if (response === null) return 'The extension did not answer. It may need reloading.'
  if (!response.ok) return response.error
  if ('accepted' in response && !response.accepted) return response.error ?? 'The worker no longer has that prompt.'
  return null
}

export function useTaskBridge() {
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [question, setQuestion] = useState<PendingQuestion | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [answerError, setAnswerError] = useState<string | null>(null)

  /** What an event means for the prompts on screen; safe to run twice. */
  const applyStatus = useCallback((event: TaskEvent): void => {
    if (event.type === 'approval') {
      setAnswerError(null)
      setApproval({
        id: event.id,
        tool: event.tool,
        summary: event.summary ?? '',
        level: event.level,
        reasons: event.reasons,
        hardBlock: event.hardBlock,
      })
    } else if (event.type === 'approval-resolved') {
      setApproval((prev) => (prev?.id === event.id ? null : prev))
    } else if (event.type === 'question') {
      setAnswerError(null)
      setQuestion({ id: event.id, question: event.question })
    } else if (event.type === 'question-resolved') {
      setQuestion((prev) => (prev?.id === event.id ? null : prev))
    } else if (event.type === 'done' || event.type === 'failed') {
      setRunning(false)
      setApproval(null)
      setQuestion(null)
    }
  }, [])

  const applyEvent = useCallback(
    (event: TaskEvent): void => {
      setEvents((prev) => [...prev.slice(-199), event])
      applyStatus(event)
    },
    [applyStatus],
  )

  useEffect(() => {
    if (!inExtension) return
    const listener = (message: unknown): undefined => {
      if (!isTaskEventMessage(message)) return undefined
      applyEvent(message.event)
      return undefined
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [applyEvent])

  /**
   * The panel is a document that comes and goes; the run does not. Without this
   * a panel reopened over a live task shows an idle UI: no timeline, no Stop
   * button, and an approval raised while it was shut never reaches the screen,
   * so the agent waits for an answer nobody can see.
   */
  useEffect(() => {
    if (!inExtension) return
    let cancelled = false
    void send({ kind: 'task-status' }).then((response) => {
      if (cancelled || response === null || !('running' in response)) return
      // Merge, never clear: an event the live listener already delivered while
      // this request was in flight is still the newest truth about the run.
      setEvents((prev) => backfillEvents(response.events, prev))
      for (const event of response.events) applyStatus(event)
      setRunning(response.running)
    })
    return () => {
      cancelled = true
    }
  }, [applyStatus])

  const start = useCallback(async (goal: string, mode: AgentMode): Promise<boolean> => {
    setEvents([])
    setStartError(null)
    setAnswerError(null)
    const response = await send({ kind: 'run-task', goal, mode })
    if (response && response.ok && 'accepted' in response) {
      if (response.accepted) {
        setRunning(true)
        return true
      }
      setStartError(response.error ?? 'Task was rejected.')
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
    await send({ kind: 'stop-task' })
  }, [])

  const answerApproval = useCallback(async (id: string, approved: boolean): Promise<void> => {
    const response = await send({ kind: 'approve-action', id, approved })
    const failure = answerFailure(response)
    // The card stays on screen when the worker did not take the answer, so the
    // user can retry instead of watching a prompt that never arrives.
    if (failure === null) setApproval(null)
    setAnswerError(failure)
  }, [])

  const answerQuestion = useCallback(async (id: string, text: string): Promise<void> => {
    const response = await send({ kind: 'answer-question', id, answer: text })
    const failure = answerFailure(response)
    if (failure === null) setQuestion(null)
    setAnswerError(failure)
  }, [])

  return {
    running,
    events,
    approval,
    question,
    startError,
    answerError,
    start,
    stop,
    answerApproval,
    answerQuestion,
  }
}
