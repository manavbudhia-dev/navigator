import { interpolate, missingParams, resolveStep } from './params'

import type { ElementTarget, Recipe, RecipeStep } from './types'

/**
 * FAST-mode replay (spec §11b).
 *
 * The recording is tried first and the model is only asked about the one step
 * that did not work — which is what keeps a scheduled recipe from spending
 * 40 tokens-per-step decisions to do something it has already done. The engine
 * knows nothing about Chrome: the caller supplies the page, the tools and the
 * safety gate, so the whole policy is testable in a unit test.
 */

export type ReplayMode = 'recorded' | 'healed' | 'denied'

export interface ReplayStepResult {
  n: number
  tool: string
  note: string
  mode: ReplayMode
  detail: string
}

export interface ReplayResult {
  ok: boolean
  detail: string
  steps: ReplayStepResult[]
  /** Steps the model had to re-decide — the number to watch as a site drifts. */
  healed: number
}

export interface ReplayDeps {
  /** Re-read the page so the next index lookup is against the live DOM. */
  refresh(): Promise<void>
  /** Where the remembered control lives now, or null when the page moved on. */
  findIndex(target: ElementTarget): Promise<number | null>
  /** Run the recorded tool. `index` is null for steps that point at nothing. */
  execute(step: RecipeStep, index: number | null): Promise<{ ok: boolean; content: string }>
  /** Risk gate: false means the user said no, or the mode forbids it. */
  permit(step: RecipeStep): Promise<boolean>
  /** Ask the model to achieve just this step on the current page. */
  heal(step: RecipeStep, values: Readonly<Record<string, string>>, n: number): Promise<string | null>
  signal?: AbortSignal
}

function stepWorthHealing(step: RecipeStep): boolean {
  return step.target !== null || step.tool === 'navigate' || step.tool === 'fill_form'
}

/**
 * Where a run that owns no tab should start: the first recorded `navigate`,
 * with its variables filled in. A recipe that never navigated has no page of
 * its own, so it is replayed against whatever the user is looking at.
 */
export function startUrl(recipe: Recipe, values: Readonly<Record<string, string>>): string | null {
  for (const step of recipe.steps) {
    const url = step.tool === 'navigate' ? step.args['url'] : undefined
    if (typeof url === 'string' && url !== '') return interpolate(url, values)
  }
  return null
}

export async function replayRecipe(
  recipe: Recipe,
  values: Readonly<Record<string, string>>,
  deps: ReplayDeps,
): Promise<ReplayResult> {
  const missing = missingParams(recipe, values)
  if (missing.length > 0) {
    throw new Error(`The recipe needs values for: ${missing.join(', ')}.`)
  }

  const steps: ReplayStepResult[] = []
  let healed = 0
  let stopped: string | null = null

  for (let n = 0; n < recipe.steps.length; n += 1) {
    if (deps.signal?.aborted === true) {
      stopped = `Stopped by the user after ${steps.length} step(s).`
      break
    }

    const step = resolveStep(recipe.steps[n]!, values)
    await deps.refresh()

    const index = step.target === null ? null : await deps.findIndex(step.target)
    if (step.target !== null && index === null) {
      // The selector is dead: the page changed, or the site was re-styled.
      const rescued = stepWorthHealing(step) ? await deps.heal(step, values, n + 1) : null
      if (rescued === null) {
        stopped = `Step ${n + 1} (${step.tool}) could not find "${step.target.label}" and the model had no alternative.`
        break
      }
      healed += 1
      steps.push({ n: n + 1, tool: step.tool, note: step.note, mode: 'healed', detail: rescued })
      continue
    }

    if (!(await deps.permit(step))) {
      stopped = `You declined step ${n + 1} (${step.tool}), so the recipe stopped there.`
      steps.push({ n: n + 1, tool: step.tool, note: step.note, mode: 'denied', detail: 'Declined.' })
      break
    }

    const result = await deps.execute(step, index)
    if (!result.ok) {
      const rescued = stepWorthHealing(step) ? await deps.heal(step, values, n + 1) : null
      if (rescued === null) {
        stopped = `Step ${n + 1} (${step.tool}) failed: ${result.content}`
        break
      }
      healed += 1
      steps.push({ n: n + 1, tool: step.tool, note: step.note, mode: 'healed', detail: rescued })
      continue
    }
    steps.push({ n: n + 1, tool: step.tool, note: step.note, mode: 'recorded', detail: result.content })
  }

  const ok = stopped === null
  const recorded = steps.filter((step) => step.mode === 'recorded').length
  const detail =
    stopped === null
      ? `${recorded} step(s) replayed as recorded${healed === 0 ? '' : `, ${healed} re-decided by the model`}.`
      : stopped

  return { ok, detail, steps, healed }
}
