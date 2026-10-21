import { useCallback, useEffect, useState } from 'react'

import { inExtension } from '@/lib/extension'
import { paramsInRecipe } from '@/recipes/params'
import { deleteRecipe, listRecipes, saveRecipe } from '@/recipes/store'
import { isTaskEventMessage, type TaskEvent } from '@/types/task'
import type { AgentMode } from '@/types/agent'
import type { Recipe, RecipeSchedule } from '@/recipes/types'
import type { BackgroundMessage, BackgroundResponse } from '@/types/messages'

/**
 * Side panel window onto the recipe library (spec §11). The documents live in
 * IndexedDB, so reads and writes go straight there; only what needs Chrome —
 * replaying against a live tab and arming `chrome.alarms` — is asked of the
 * service worker.
 */

export interface PendingStep {
  id: string
  tool: string
  summary: string
  level: string
  reasons: string[]
  hardBlock: string | null
}

export interface RecipeOutcome {
  id: string
  name: string
  ok: boolean
  detail: string
  healed: number
}

export interface ReplayLine {
  at: number
  text: string
  tone: 'info' | 'ok' | 'bad'
}

/** The steps of a replay, streamed from the worker, so the panel is not silent. */
function line(event: TaskEvent): ReplayLine | null {
  switch (event.type) {
    case 'action':
      return { at: Date.now(), text: `→ ${event.summary}`, tone: 'info' }
    case 'result':
      return { at: Date.now(), text: `${event.ok ? '✓' : '✗'} ${event.content}`, tone: event.ok ? 'ok' : 'bad' }
    case 'blocked':
      return { at: Date.now(), text: `⛔ ${event.reason}`, tone: 'bad' }
    case 'note':
      return { at: Date.now(), text: `ℹ ${event.text}`, tone: 'info' }
    default:
      return null
  }
}

async function send(message: BackgroundMessage): Promise<BackgroundResponse | null> {
  if (!inExtension) return null
  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundResponse
  } catch {
    return null
  }
}

/** The worker answers with `accepted`; a refusal is a message, not a rejection. */
function refusal(response: BackgroundResponse | null, fallback: string): string | null {
  if (response === null) return 'Not running inside Chrome, or the extension needs a reload.'
  if (!response.ok) return response.error
  if ('accepted' in response && response.accepted === false) return response.error ?? fallback
  return null
}

export function useRecipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [approval, setApproval] = useState<PendingStep | null>(null)
  const [lines, setLines] = useState<ReplayLine[]>([])
  const [outcome, setOutcome] = useState<RecipeOutcome | null>(null)

  const reload = useCallback(async () => {
    try {
      setRecipes(await listRecipes())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!inExtension) return
    const apply = (event: TaskEvent): void => {
      if (event.type === 'recipe') {
        setOutcome({ id: event.id, name: event.name, ok: event.ok, detail: event.detail, healed: event.healed })
        setRunningId(null)
        setApproval(null)
        void reload()
      } else if (event.type === 'approval') {
        setApproval({
          id: event.id,
          tool: event.tool,
          summary: event.summary,
          level: event.level,
          reasons: event.reasons,
          hardBlock: event.hardBlock,
        })
      } else if (event.type === 'approval-resolved') {
        setApproval((prev) => (prev?.id === event.id ? null : prev))
      } else if (event.type === 'done' || event.type === 'failed') {
        setRunningId(null)
        setApproval(null)
        if (event.type === 'failed') setError(event.error)
      } else {
        const text = line(event)
        if (text !== null) setLines((prev) => [...prev.slice(-39), text])
      }
    }
    const listener = (message: unknown): undefined => {
      if (!isTaskEventMessage(message)) return undefined
      apply(message.event)
      return undefined
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [reload])

  /** The variables this recipe asks for, in the order its steps mention them. */
  const fieldsFor = useCallback((recipe: Recipe): Array<{ name: string; label: string; sample: string }> => {
    const known = new Map(recipe.params.map((param) => [param.name, param]))
    return paramsInRecipe(recipe.steps).map((name) => {
      const param = known.get(name)
      return { name, label: param?.label ?? name, sample: param?.sample ?? '' }
    })
  }, [])

  /**
   * Replay in the active tab. The worker answers only once the whole workflow is
   * over, so the busy flag is raised before sending and the live events drive it
   * back down.
   */
  const run = useCallback(async (recipe: Recipe, values: Record<string, string>, mode: AgentMode): Promise<void> => {
    setError(null)
    setOutcome(null)
    setLines([])
    setRunningId(recipe.id)
    const problem = refusal(await send({ kind: 'run-recipe', id: recipe.id, values, mode }), 'The replay was refused.')
    setRunningId(null)
    if (problem !== null) setError(problem)
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    await send({ kind: 'stop-task' })
  }, [])

  /** The panel stores the plan, the worker arms the alarm. */
  const schedule = useCallback(
    async (recipe: Recipe, value: RecipeSchedule): Promise<void> => {
      setError(null)
      const next: Recipe = { ...recipe, schedule: value, updatedAt: Date.now() }
      try {
        await saveRecipe(next)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return
      }
      setRecipes((prev) => prev.map((item) => (item.id === recipe.id ? next : item)))
      const problem = refusal(await send({ kind: 'schedule-recipe', id: recipe.id }), 'Chrome refused the alarm.')
      if (problem !== null) setError(problem)
    },
    [],
  )

  const unschedule = useCallback(async (recipe: Recipe): Promise<void> => {
    setError(null)
    const problem = refusal(await send({ kind: 'unschedule-recipe', id: recipe.id }), 'The alarm is still armed.')
    if (problem !== null) setError(problem)
    await reload()
  }, [reload])

  const remove = useCallback(
    async (recipe: Recipe): Promise<void> => {
      setError(null)
      // The alarm lives in Chrome, so a scheduled recipe is disarmed first.
      if (recipe.schedule !== null) await send({ kind: 'unschedule-recipe', id: recipe.id })
      await deleteRecipe(recipe.id)
      await reload()
    },
    [reload],
  )

  const answerApproval = useCallback(async (id: string, approved: boolean): Promise<void> => {
    setApproval(null)
    await send({ kind: 'approve-action', id, approved })
  }, [])

  return {
    recipes,
    loaded,
    error,
    setError,
    runningId,
    approval,
    lines,
    outcome,
    reload,
    fieldsFor,
    run,
    stop,
    schedule,
    unschedule,
    remove,
    answerApproval,
  }
}
