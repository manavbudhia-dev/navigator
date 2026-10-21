import { paramsInRecipe } from './params'
import {
  RecipeSchema,
  type ElementTarget,
  type Recipe,
  type RecipeParam,
  type RecipeStep,
} from './types'

import type { AuditRow } from '@/memory/db'

/**
 * Turning one finished run into a reusable workflow (spec §11a).
 *
 * The audit log is the source of truth: it already holds the tool, the
 * validated arguments, whether the user approved it, and the control each
 * action touched. Reading a recipe out of it means the library can only ever
 * contain things that actually happened — a blocked or failed step is not a
 * step.
 */

/**
 * What replays as itself. Reads (`read_page`, tab queries) are re-done by the
 * engine, human tools are not automatable, and tab tools carry ids from a
 * browser window that no longer exists. `drag_and_drop` is deliberately absent:
 * replay hands back one index, and a drag needs two.
 */
const REPLAYABLE = new Set([
  'navigate',
  'click',
  'type_text',
  'scroll',
  'wait',
  'fill_form',
  'hover',
  'press_key',
  'select_option',
  'check',
  'upload_file',
  'go_back',
  'go_forward',
  'reload',
  'wait_for',
  // The one data tool worth replaying: "fetch this month's invoice" is a
  // workflow. A screenshot or a note-to-memory is not.
  'download_file',
])

/** Tools that point at a control, so a missing target means an unusable step. */
const NEEDS_TARGET = new Set(['click', 'type_text', 'hover', 'select_option', 'check', 'upload_file'])

const WAIT_CONDITIONS = new Set(['load', 'selector', 'text', 'quiet'])

const MAX_NOTE = 140

export function clipNote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_NOTE ? `${flat.slice(0, MAX_NOTE - 1)}…` : flat
}

function paramNameFor(label: string): string | null {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
    .replace(/_+$/, '')
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(slug)) return null
  return slug
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

function targetOf(row: AuditRow): ElementTarget | null {
  return row.target ?? null
}

/** Steps worth keeping, in order, with their element indices forgotten. */
export function stepsFromRun(rows: readonly AuditRow[]): RecipeStep[] {
  const out: RecipeStep[] = []
  for (const row of rows) {
    if (row.ok !== true) continue
    if (row.decision !== 'allow' && row.decision !== 'approved') continue
    if (!REPLAYABLE.has(row.tool)) continue

    const args: Record<string, unknown> = {}
    if (row.tool === 'navigate') {
      if (typeof row.args['url'] !== 'string') continue
      args['url'] = row.args['url']
    } else if (row.tool === 'type_text') {
      if (typeof row.args['text'] !== 'string') continue
      args['text'] = row.args['text']
      if (row.args['submit'] === true) args['submit'] = true
    } else if (row.tool === 'press_key') {
      if (typeof row.args['key'] !== 'string') continue
      args['key'] = row.args['key']
    } else if (row.tool === 'select_option') {
      if (typeof row.args['value'] !== 'string') continue
      args['value'] = row.args['value']
    } else if (row.tool === 'check') {
      if (typeof row.args['state'] !== 'boolean') continue
      args['state'] = row.args['state']
    } else if (row.tool === 'upload_file') {
      // Only the name of the stored document is recorded, never its contents.
      if (typeof row.args['file_ref'] !== 'string') continue
      args['file_ref'] = row.args['file_ref']
      if (typeof row.args['profile_id'] === 'string') args['profile_id'] = row.args['profile_id']
    } else if (row.tool === 'wait_for') {
      const condition = row.args['condition']
      if (typeof condition !== 'string' || !WAIT_CONDITIONS.has(condition)) continue
      args['condition'] = condition
      if (typeof row.args['value'] === 'string') args['value'] = row.args['value']
      if (typeof row.args['timeout_seconds'] === 'number') args['timeout_seconds'] = row.args['timeout_seconds']
    } else if (row.tool === 'download_file') {
      if (typeof row.args['url'] !== 'string') continue
      args['url'] = row.args['url']
      if (typeof row.args['file_name'] === 'string') args['file_name'] = row.args['file_name']
    } else if (row.tool === 'scroll') {
      // Scrolling one element by index is not a thing a page still has later.
      if (row.args['index'] !== undefined) continue
      if (row.args['direction'] !== 'down' && row.args['direction'] !== 'up') continue
      args['direction'] = row.args['direction']
      if (typeof row.args['amount'] === 'number') args['amount'] = row.args['amount']
    } else if (row.tool === 'wait') {
      if (typeof row.args['seconds'] !== 'number') continue
      args['seconds'] = row.args['seconds']
    } else if (row.tool === 'fill_form') {
      if (typeof row.args['profile_id'] === 'string') args['profile_id'] = row.args['profile_id']
    }

    // Hovering, ticking or choosing a control that can no longer be found
    // would replay as a click on nothing.
    if (NEEDS_TARGET.has(row.tool) && targetOf(row) === null) continue

    const step: RecipeStep = { tool: row.tool, args, note: clipNote(row.detail), target: targetOf(row) }

    // A retried action leaves two identical rows; the workflow needs one.
    const previous = out[out.length - 1]
    if (
      previous !== undefined &&
      previous.tool === step.tool &&
      previous.target?.label === step.target?.label &&
      JSON.stringify(previous.args) === JSON.stringify(step.args)
    ) {
      out[out.length - 1] = step
      continue
    }
    out.push(step)
  }
  return out
}

/**
 * Values the model typed are the one part of a run that is almost always
 * different next time, so each typed field becomes a `{{parameter}}` and the
 * recorded value becomes its default.
 */
export function paramsForSteps(steps: readonly RecipeStep[]): { steps: RecipeStep[]; params: RecipeParam[] } {
  const taken = new Set<string>()
  const params: RecipeParam[] = []

  const rewritten = steps.map((step) => {
    if (step.tool !== 'type_text') return step
    const text = step.args['text']
    if (typeof text !== 'string' || text === '' || text.includes('{{')) return step
    const base = step.target === null ? null : paramNameFor(step.target.label)
    if (base === null) return step

    const name = uniqueName(base, taken)
    taken.add(name)
    params.push({ name, label: step.target!.label, sample: text })
    return { ...step, args: { ...step.args, text: `{{${name}}}` } }
  })

  return { steps: rewritten, params }
}

export interface RecipeDraftInput {
  name: string
  goal: string
  /** Text the run used. False keeps the recording byte-for-byte. */
  parameterize?: boolean
  createdAt?: number
  originRunId?: string | null
}

/** A recipe, unsaved, from one run's audit rows. Throws when nothing replayable happened. */
export function recipeFromRun(rows: readonly AuditRow[], input: RecipeDraftInput): Recipe {
  const raw = stepsFromRun(rows)
  if (raw.length === 0) {
    throw new Error('Nothing in this run can be replayed — it had no successful page actions.')
  }
  const parameterize = input.parameterize ?? true
  const { steps, params } = parameterize ? paramsForSteps(raw) : { steps: raw, params: [] }
  const at = input.createdAt ?? Date.now()

  return RecipeSchema.parse({
    id: crypto.randomUUID(),
    name: input.name.trim().slice(0, 80) || 'Untitled recipe',
    goal: input.goal,
    createdAt: at,
    updatedAt: at,
    steps,
    // A parameter that no step mentions is noise in the run form.
    params: params.filter((param) => paramsInRecipe(steps).includes(param.name)),
    schedule: null,
    lastRun: null,
    originRunId: input.originRunId ?? null,
  })
}

/** The run's own goal text, shortened enough to be a recipe name. */
export function nameFromGoal(goal: string): string {
  const flat = goal.replace(/\s+/g, ' ').trim()
  const firstSentence = flat.split(/[.!?]\s/)[0] ?? flat
  return firstSentence.slice(0, 60) || 'Saved workflow'
}
