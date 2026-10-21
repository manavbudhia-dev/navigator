import type { RecipeStep } from '@/recipes/types'

/**
 * One-step repair prompt (spec §11b). A recipe that stops working is usually
 * one button having moved, not the whole workflow being wrong — so the model
 * gets that one step and no latitude to "helpfully" continue the task.
 */

const MAX_ARGS = 200

function describe(step: RecipeStep): string {
  const where = step.target === null ? 'nothing in particular' : `"${step.target.label}"`
  const args = JSON.stringify(step.args).slice(0, MAX_ARGS)
  return `${step.tool} on ${where} with ${args}${step.note === '' ? '' : ` (recorded as: ${step.note})`}`
}

export function healGoal(
  recipeName: string,
  n: number,
  step: RecipeStep,
  values: Readonly<Record<string, string>>,
  problem: string,
): string {
  const entries = Object.entries(values)
  const filled = entries.length === 0 ? '(none)' : entries.map(([key, value]) => `${key} = ${value}`).join(', ')

  return [
    `A saved workflow ("${recipeName}") is being replayed and step ${n} stopped working.`,
    `The step that failed: ${describe(step)}.`,
    `Values for this run: ${filled}.`,
    `What went wrong: ${problem}`,
    '',
    'Do exactly this one thing and nothing else. Read the page, then use the tool that gets the same result here.',
    'If the same outcome is reachable another way, take that way.',
    'When it is done, call finish with success=true and one short sentence about what you did.',
    'If you cannot do it, call finish with success=false and say why. Do not start any other task.',
  ].join('\n')
}
