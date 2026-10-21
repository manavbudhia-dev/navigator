import { describe, expect, it } from 'vitest'

import {
  interpolate,
  missingParams,
  paramsInRecipe,
  paramsInStep,
  resolveRecipe,
  resolveStep,
} from './params'
import type { Recipe, RecipeStep } from './types'

const TARGET = {
  selector: {
    css: '#city',
    xpath: '/html/body/input',
    textAnchor: '',
    bbox: { x: 10, y: 20, width: 100, height: 24 },
    tag: 'input',
    role: 'textbox' as const,
    frameUrl: null,
  },
  label: 'City',
  role: 'textbox' as const,
  inputType: 'text',
}

function step(overrides: Partial<RecipeStep> & Pick<RecipeStep, 'tool'>): RecipeStep {
  return { args: {}, note: '', target: null, ...overrides }
}

function recipe(steps: RecipeStep[]): Recipe {
  const at = 1_700_000_000_000
  return {
    id: 'r1',
    name: 'Apply for jobs',
    goal: 'apply on the board',
    createdAt: at,
    updatedAt: at,
    steps,
    params: [],
    schedule: null,
    lastRun: null,
    originRunId: null,
  }
}

describe('paramsInStep', () => {
  it('finds variables in any string argument, nested or plain', () => {
    const found = paramsInStep(
      step({
        tool: 'navigate',
        args: {
          url: 'https://example.com/jobs?q={{job_title}}&loc={{ city }}',
          headers: [{ name: 'X-Note', value: '{{job_title}}' }],
          count: 3,
        },
      }),
    )
    expect(found).toEqual(['job_title', 'city'])
  })

  it('reports nothing for a step with no variables', () => {
    expect(paramsInStep(step({ tool: 'wait', args: { seconds: 2 } }))).toEqual([])
  })
})

describe('paramsInRecipe', () => {
  it('lists each name once, in first-seen order', () => {
    const names = paramsInRecipe([
      step({ tool: 'type_text', args: { text: '{{city}}' } }),
      step({ tool: 'navigate', args: { url: 'https://x/{{company}}/jobs?q={{city}}' } }),
    ])
    expect(names).toEqual(['city', 'company'])
  })
})

describe('interpolate', () => {
  it('replaces known variables and leaves unknown ones alone', () => {
    expect(interpolate('Hi {{first}} {{last}}', { first: 'Manav' })).toBe('Hi Manav {{last}}')
  })

  it('ignores braces whose contents are not a parameter name', () => {
    expect(interpolate('cost {{ 100 }} in {{City}}', { city: 'Pune' })).toBe('cost {{ 100 }} in {{City}}')
  })
})

describe('resolveStep', () => {
  it('fills variables at any depth without touching other keys', () => {
    const resolved = resolveStep(
      step({ tool: 'type_text', args: { text: '{{city}}', submit: true, count: 2 }, target: TARGET }),
      { city: 'Pune' },
    )
    expect(resolved.args).toEqual({ text: 'Pune', submit: true, count: 2 })
    expect(resolved.target).toBe(TARGET)
  })
})

describe('resolveRecipe', () => {
  it('resolves every step against the same values', () => {
    const steps = resolveRecipe(
      recipe([step({ tool: 'type_text', args: { text: '{{city}}' } }), step({ tool: 'wait', args: { seconds: 1 } })]),
      { city: 'Pune' },
    )
    expect(steps.map((entry) => entry.args['text'] ?? entry.args['seconds'])).toEqual(['Pune', 1])
  })
})

describe('missingParams', () => {
  it('reports variables with no answer, or a blank one', () => {
    const entry = recipe([
      step({ tool: 'type_text', args: { text: '{{city}}' } }),
      step({ tool: 'type_text', args: { text: '{{company}}' } }),
      step({ tool: 'navigate', args: { url: 'https://x/{{role}}' } }),
    ])
    expect(missingParams(entry, { city: 'Pune', company: '  ', role: 'dev' })).toEqual(['company'])
  })

  it('is empty for a recipe with no variables', () => {
    expect(missingParams(recipe([step({ tool: 'wait', args: { seconds: 1 } })]), {})).toEqual([])
  })
})
