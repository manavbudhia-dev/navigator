import { useCallback, useMemo, useState } from 'react'
import { BookmarkPlus } from 'lucide-react'

import { nameFromGoal, recipeFromRun, stepsFromRun } from '@/recipes/fromRun'
import { saveRecipe } from '@/recipes/store'
import { cn } from '@/lib/utils'
import type { AuditRow } from '@/memory/db'

/**
 * "Save as Recipe" (spec §11a). Offered on a run that actually did something
 * to a page: the recipe is read out of that run's audit rows, so it can only
 * ever contain steps that happened and were allowed.
 */
export function SaveRecipeButton({
  rows,
  goal,
  runId,
  onSaved,
}: {
  rows: AuditRow[]
  goal: string
  runId: string | null
  onSaved?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => nameFromGoal(goal))
  const [parameterize, setParameterize] = useState(true)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const replayable = useMemo(() => stepsFromRun(rows).length, [rows])

  const commit = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const recipe = recipeFromRun(rows, {
        name,
        goal,
        parameterize,
        ...(runId === null ? {} : { originRunId: runId }),
      })
      await saveRecipe(recipe)
      setSaved(recipe.name)
      onSaved?.(recipe.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [goal, name, onSaved, parameterize, rows, runId])

  if (replayable === 0 && !open) {
    return (
      <button
        type="button"
        disabled
        title="This run has no successful page actions to record."
        className="rounded-lg border border-dashed px-2.5 py-1 text-[11px] font-semibold text-muted-foreground/60"
      >
        Nothing to save
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open ? (
        <div className="flex w-full flex-col gap-2 rounded-lg bg-muted/40 p-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="shrink-0 font-semibold">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Recipe name"
              className="h-7 min-w-0 flex-1 rounded-md border bg-card px-2 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={parameterize}
              onChange={(event) => setParameterize(event.target.checked)}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              Turn each typed value into a variable (
              <code className="text-[11px]">{'{{job_title}}'}</code>) so the next replay can be
              filled in with different text.
            </span>
          </label>
          <p className="text-[11px] text-muted-foreground">
            {replayable} of {rows.length} logged action(s) in this run can be replayed. Blocked,
            denied and failed steps are left out.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void commit()}
              className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Save recipe
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setSaved(null)
                setError(null)
              }}
              className="rounded-lg border bg-card px-3 py-1.5 font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            {saved === null ? null : (
              <span className="text-emerald-700" role="status" data-saved-recipe={saved}>
                Saved “{saved}” — replay it from Recipes.
              </span>
            )}
          </div>
          {error ? (
            <p className="text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-muted',
            saved === null ? 'bg-card' : 'border-emerald-300 bg-emerald-50 text-emerald-800',
          )}
        >
          <BookmarkPlus className="size-3.5" strokeWidth={1.8} aria-hidden />
          {saved === null ? 'Save as Recipe' : `Saved “${saved}”`}
        </button>
      )}
    </div>
  )
}
