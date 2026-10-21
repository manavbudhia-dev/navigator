import { useCallback, useEffect, useState } from 'react'

import { inExtension } from '@/lib/extension'
import { isTaskEventMessage, type TaskEvent } from '@/types/task'
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

export function useTaskBridge() {
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [question, setQuestion] = useState<PendingQuestion | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    if (!inExtension) return
    const listener = (message: unknown): undefined => {
      if (!isTaskEventMessage(message)) return undefined
      const event = message.event
      setEvents((prev) => [...prev.slice(-199), event])
      if (event.type === 'approval') {
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
        setQuestion({ id: event.id, question: event.question })
      } else if (event.type === 'question-resolved') {
        setQuestion((prev) => (prev?.id === event.id ? null : prev))
      } else if (event.type === 'done' || event.type === 'failed') {
        setRunning(false)
        setApproval(null)
        setQuestion(null)
      }
      return undefined
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const start = useCallback(async (goal: string, mode: AgentMode): Promise<boolean> => {
    setEvents([])
    setStartError(null)
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
    setApproval(null)
    await send({ kind: 'approve-action', id, approved })
  }, [])

  const answerQuestion = useCallback(async (id: string, text: string): Promise<void> => {
    setQuestion(null)
    await send({ kind: 'answer-question', id, answer: text })
  }, [])

  return { running, events, approval, question, startError, start, stop, answerApproval, answerQuestion }
}
