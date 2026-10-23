import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Clock, Download, Play, Square, Trash2, Upload, Workflow } from 'lucide-react'

import { useRecipes, type PendingStep } from '../useRecipes'
import { SiteRuleButton } from './SiteRuleButton'
import { saveTextFile, stampedFilename } from '@/lib/download'
import { importRecipesJson, recipeFileJson, recipesExportJson } from '@/recipes/store'
import type { Recipe, RecipeSchedule } from '@/recipes/types'
import { cn } from '@/lib/utils'
import { formatWhen } from '@/memory/history'
import { AGENT_MODES, MODE_LABELS, type AgentMode } from '@/types/agent'

/**
 * The recipe library (spec §11b): replay a saved workflow with new values,
 * schedule it, or move it out as JSON. One bridge, one service-worker run —
 * the cards read it through context because two lists polling the same
 * IndexedDB table would disagree with each other.
 */

type Bridge = ReturnType<typeof useRecipes>

const BridgeContext = createContext<Bridge | null>(null)

function useBridge(): Bridge {
  const bridge = useContext(BridgeContext)
  if (bridge === null) throw new Error('Recipe cards must render inside the recipe library.')
  return bridge
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const SHORT_MODE: Record<AgentMode, string> = {
  observe: 'Read-only',
  copilot: 'Ask me first',
  auto: 'Auto',
}

function scheduleLabel(value: RecipeSchedule): string {
  const at = `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`
  return value.frequency === 'daily' ? `Every day at ${at}` : `Every ${DAYS[value.dayOfWeek ?? 1]} at ${at}`
}

function StepList({ recipe }: { recipe: Recipe }) {
  return (
    <ol className="flex flex-col gap-1 border-t px-3 pb-3 pt-2 text-xs">
      {recipe.steps.map((step, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="shrink-0 tabular-nums text-muted-foreground">{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{step.tool}</span>
            {step.target === null ? null : <span className="text-muted-foreground"> on {step.target.label}</span>}
            {Object.keys(step.args).length === 0 ? null : (
              <code className="ml-1 break-all text-[11px] text-muted-foreground">{JSON.stringify(step.args)}</code>
            )}
            <span className="block truncate text-[11px] text-muted-foreground">{step.note}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Values for this replay; every box starts on the value the recording used. */
function RunForm({ recipe }: { recipe: Recipe }) {
  const bridge = useBridge()
  const fields = bridge.fieldsFor(recipe)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of fields) initial[field.name] = field.sample
    return initial
  })
  const [mode, setMode] = useState<AgentMode>('copilot')
  const busy = bridge.runningId === recipe.id
  const missing = fields.filter((field) => (values[field.name] ?? '').trim() === '')

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/30 px-3 py-2">
      {fields.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          This recipe has no variables — it replays exactly what it recorded.
        </p>
      ) : (
        fields.map((field) => (
          <label key={field.name} className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 truncate font-semibold" title={`{{${field.name}}}`}>
              {field.label}
            </span>
            <input
              value={values[field.name] ?? ''}
              onChange={(event) => setValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
              className="h-7 min-w-0 flex-1 rounded-md border bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        ))
      )}
      <div className="flex items-center gap-2">
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as AgentMode)}
          aria-label="Approval mode for this replay"
          className="h-7 rounded-md border bg-card px-1.5 text-xs"
        >
          {AGENT_MODES.map((value) => (
            <option key={value} value={value}>
              {SHORT_MODE[value]} · {MODE_LABELS[value].split(' (')[0]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || missing.length > 0}
          onClick={() => void bridge.run(recipe, values, mode)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <Play className="size-3.5" strokeWidth={2} aria-hidden />
          {busy ? 'Replaying…' : 'Replay here'}
        </button>
      </div>
      {missing.length > 0 ? (
        <p className="text-[11px] text-amber-700">Fill in: {missing.map((field) => field.label).join(', ')}</p>
      ) : null}
      {busy ? (
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
            Replaying in the active tab — recorded steps first, the model only sees one that fails.
          </p>
          <button
            type="button"
            onClick={() => void bridge.stop()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
          >
            <Square className="size-3" strokeWidth={2} aria-hidden />
            Stop
          </button>
        </div>
      ) : null}
      {busy && bridge.lines.length > 0 ? (
        <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto border-t pt-1 text-[11px]">
          {bridge.lines.map((item, index) => (
            <li
              key={index}
              className={cn(
                'truncate',
                item.tone === 'bad' ? 'text-red-600' : item.tone === 'ok' ? 'text-emerald-700' : 'text-muted-foreground',
              )}
            >
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** The feed only belongs to the run in flight. */
function isRunning(busy: boolean, lines: readonly unknown[]): boolean {
  return busy && lines.length > 0
}

function ScheduleForm({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const bridge = useBridge()
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(recipe.schedule?.frequency ?? 'daily')
  const [at, setAt] = useState(
    `${String(recipe.schedule?.hour ?? 9).padStart(2, '0')}:${String(recipe.schedule?.minute ?? 0).padStart(2, '0')}`,
  )
  const [day, setDay] = useState(String(recipe.schedule?.dayOfWeek ?? 1))
  const [error, setError] = useState<string | null>(null)

  const enable = useCallback(async (): Promise<void> => {
    const [hour, minute] = at.split(':').map(Number)
    if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
      setError('Use a time like 09:30.')
      return
    }
    const schedule: RecipeSchedule = {
      frequency,
      hour: Math.min(23, Math.max(0, Math.trunc(hour))),
      minute: Math.min(59, Math.max(0, Math.trunc(minute))),
      dayOfWeek: frequency === 'weekly' ? Number(day) : null,
    }
    await bridge.schedule(recipe, schedule)
    onClose()
  }, [at, bridge, day, frequency, onClose, recipe])

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/30 px-3 py-2 text-xs">
      <p className="text-[11px] text-muted-foreground">
        A scheduled run opens its own background window and never approves itself — anything that
        needs permission stops there and says so in the history.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as 'daily' | 'weekly')}
          aria-label="How often"
          className="h-7 rounded-md border bg-card px-1.5"
        >
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
        </select>
        {frequency === 'weekly' ? (
          <select
            value={day}
            onChange={(event) => setDay(event.target.value)}
            aria-label="Which day"
            className="h-7 rounded-md border bg-card px-1.5"
          >
            {DAYS.map((name, index) => (
              <option key={name} value={String(index)}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        <input
          type="time"
          value={at}
          onChange={(event) => setAt(event.target.value)}
          aria-label="What time"
          className="h-7 rounded-md border bg-card px-2"
        />
        <button
          type="button"
          onClick={() => void enable()}
          className="ml-auto rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Turn on
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border bg-card px-3 py-1.5 font-semibold hover:bg-muted"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ApprovalCard({ approval, onAnswer }: { approval: PendingStep; onAnswer: (approved: boolean) => void }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900">
        The replay needs you for: {approval.summary}
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        risk: {approval.level}
        {approval.hardBlock ? ` · hard block (${approval.hardBlock})` : ''}
        {approval.reasons.length > 0 ? ` · ${approval.reasons.join('; ')}` : ''}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          Deny
        </button>
      </div>
      {/* Same rules as the task card: allowing a site would still ask after a hard
          block, so that button only answers a card the site caused, while
          closing the site entirely answers any card at all. */}
      {approval.host !== '' ? (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-amber-200 pt-2">
          {approval.hardBlock === null ? (
            <SiteRuleButton list="allow" host={approval.host} />
          ) : null}
          <SiteRuleButton list="block" host={approval.host} />
        </div>
      ) : null}
    </div>
  )
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  const bridge = useBridge()
  const [open, setOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const isRunning = bridge.runningId === recipe.id
  const result = bridge.outcome?.id === recipe.id ? bridge.outcome : null
  const variableCount = useMemo(() => bridge.fieldsFor(recipe).length, [bridge, recipe])

  return (
    <article className="rounded-xl border bg-card" data-recipe={recipe.name}>
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-semibold">{recipe.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {recipe.steps.length} step{recipe.steps.length === 1 ? '' : 's'}
            {variableCount === 0 ? '' : ` · ${variableCount} variable${variableCount === 1 ? '' : 's'}`}
            {recipe.schedule === null ? '' : ` · ${scheduleLabel(recipe.schedule)}`}
          </p>
          {recipe.lastRun === null ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Never replayed.</p>
          ) : (
            <p
              className={cn('mt-0.5 truncate text-[11px]', recipe.lastRun.ok ? 'text-emerald-700' : 'text-red-600')}
              title={recipe.lastRun.detail}
            >
              {recipe.lastRun.ok ? 'Last replay' : 'Last replay failed'}: {recipe.lastRun.detail} ·{' '}
              {formatWhen(recipe.lastRun.at)}
            </p>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => (recipe.schedule === null ? setScheduleOpen(true) : void bridge.unschedule(recipe))}
            title={recipe.schedule === null ? 'Schedule this recipe' : 'Stop the schedule'}
            aria-label={recipe.schedule === null ? `Schedule ${recipe.name}` : `Unschedule ${recipe.name}`}
            className={cn(
              'rounded-lg p-1.5 transition-colors hover:bg-muted',
              recipe.schedule === null ? 'text-muted-foreground hover:text-foreground' : 'bg-blue-50 text-blue-700',
            )}
          >
            <Clock className="size-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => void saveTextFile(`${recipe.name.slice(0, 40)}.json`, 'application/json', recipeFileJson(recipe))}
            title="Export this recipe"
            aria-label={`Export ${recipe.name}`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="size-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => void bridge.remove(recipe)}
            title="Delete this recipe"
            aria-label={`Delete ${recipe.name}`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-4" strokeWidth={1.8} />
          </button>
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            strokeWidth={1.8}
            aria-hidden
          />
        </div>
      </div>
      {isRunning && bridge.approval ? (
        <div className="px-3 pb-3">
          <ApprovalCard
            approval={bridge.approval}
            onAnswer={(approved) => void bridge.answerApproval(bridge.approval?.id ?? '', approved)}
          />
        </div>
      ) : null}
      {result === null || isRunning ? null : (
        <p
          className={cn('border-t px-3 py-2 text-xs', result.ok ? 'text-emerald-700' : 'text-red-600')}
          role="status"
          data-last-replay
        >
          {result.detail}
        </p>
      )}
      <RunForm recipe={recipe} />
      {scheduleOpen ? <ScheduleForm recipe={recipe} onClose={() => setScheduleOpen(false)} /> : null}
      {open ? <StepList recipe={recipe} /> : null}
    </article>
  )
}

export function RecipeLibrary({ refreshKey = 0 }: { refreshKey?: number }) {
  const bridge = useRecipes()
  const [notice, setNotice] = useState<string | null>(null)
  const reload = bridge.reload

  // A run saved from a session card lands in the same table this list reads.
  useEffect(() => {
    if (refreshKey > 0) void reload()
  }, [refreshKey, reload])

  const exportAll = useCallback(async (): Promise<void> => {
    await saveTextFile(
      stampedFilename('navigator-recipes', 'json'),
      'application/json',
      recipesExportJson(bridge.recipes),
    )
  }, [bridge.recipes])

  const importFile = useCallback(
    async (file: File): Promise<void> => {
      setNotice(null)
      try {
        const result = await importRecipesJson(await file.text())
        bridge.reload()
        setNotice(
          result.collided === 0
            ? `Imported ${result.imported} recipe(s).`
            : `Imported ${result.imported} recipe(s); ${result.collided} already existed, so they came in as copies.`,
        )
      } catch (cause) {
        bridge.setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [bridge],
  )

  return (
    <BridgeContext.Provider value={bridge}>
      <section className="flex flex-col gap-2" data-recipes>
        <div className="flex items-center gap-2.5">
          <Workflow className="size-5 text-primary" strokeWidth={1.8} aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold tracking-tight">Recipes</h2>
            <p className="text-xs text-muted-foreground">
              Saved workflows that replay without a model — and ask for one only when a step breaks.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void exportAll()}
            disabled={bridge.recipes.length === 0}
            aria-label="Export every recipe as JSON"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Download className="size-4" strokeWidth={1.8} />
          </button>
          <label
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Import recipes from a JSON file"
          >
            <Upload className="size-4" strokeWidth={1.8} />
            <span className="sr-only">Import recipes from a JSON file</span>
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) void importFile(file)
                event.target.value = ''
              }}
            />
          </label>
        </div>

        {notice ? (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700" role="status">
            {notice}
          </p>
        ) : null}
        {bridge.error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
            {bridge.error}
          </p>
        ) : null}

        {!bridge.loaded ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : bridge.recipes.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm font-semibold">No recipes yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Finish a task, then press “Save as Recipe” on it. A replay uses the recorded page first
              and only calls the model for a step that no longer matches.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {bridge.recipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </div>
        )}
      </section>
    </BridgeContext.Provider>
  )
}
