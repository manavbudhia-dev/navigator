import type { Recipe, RecipeStep } from './types'

/**
 * Recipe variables (spec §11): `{{job_title}}` inside any recorded argument.
 * A recipe with no `{{…}}` is a macro — replaying it does exactly what the run
 * did. Placeholders are what turn it into a form you can fill in each month.
 */

/**
 * `{{ city }}` is the same parameter as `{{city}}`, and the name grammar is
 * the one `RecipeParamSchema` accepts — so a placeholder that will never
 * resolve is never collected as a parameter either.
 */
const PARAM_IN_TEXT = /\{\{\s*([a-z][a-z0-9_]{0,31})\s*\}\}/g

function names(value: unknown): string[] {
  if (typeof value === 'string') {
    return Array.from(value.matchAll(PARAM_IN_TEXT), (match) => match[1]!)
  }
  if (Array.isArray(value)) return value.flatMap(names)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(names)
  }
  return []
}

/** Which variables one step refers to, in the order they appear. */
export function paramsInStep(step: RecipeStep): string[] {
  return [...new Set(names(step.args))]
}

/** Every variable in a recipe, first-seen order — the form fields to fill in. */
export function paramsInRecipe(steps: readonly RecipeStep[]): string[] {
  const out: string[] = []
  for (const step of steps) {
    for (const name of paramsInStep(step)) {
      if (!out.includes(name)) out.push(name)
    }
  }
  return out
}

/** Turns `Hello {{city}}` into `Hello Pune` — unknown names are left alone. */
export function interpolate(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PARAM_IN_TEXT, (whole, name: string) => values[name] ?? whole)
}

function substitute(value: unknown, values: Readonly<Record<string, string>>): unknown {
  if (typeof value === 'string') return interpolate(value, values)
  if (Array.isArray(value)) return value.map((item) => substitute(item, values))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = substitute(item, values)
    }
    return out
  }
  return value
}

/** A copy of the step with every variable filled in, ready to execute. */
export function resolveStep(step: RecipeStep, values: Readonly<Record<string, string>>): RecipeStep {
  return { ...step, args: substitute(step.args, values) as Record<string, unknown> }
}

export function resolveRecipe(recipe: Recipe, values: Readonly<Record<string, string>>): RecipeStep[] {
  return recipe.steps.map((step) => resolveStep(step, values))
}

/** Variables the recipe needs that `values` does not answer. */
export function missingParams(recipe: Recipe, values: Readonly<Record<string, string>>): string[] {
  return paramsInRecipe(recipe.steps).filter((name) => {
    const answer = values[name]
    return answer === undefined || answer.trim() === ''
  })
}
