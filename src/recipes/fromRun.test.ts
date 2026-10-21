import { describe, expect, it } from 'vitest'

import { nameFromGoal, paramsForSteps, recipeFromRun, stepsFromRun } from './fromRun'
import type { RecipeStep } from './types'
import type { AuditRow } from '@/memory/db'
import type { ActTarget } from '@/types/actions'

function target(label: string, tag = 'input'): ActTarget {
  return {
    label,
    role: tag === 'input' ? 'textbox' : 'button',
    inputType: tag === 'input' ? 'text' : null,
    selector: {
      css: `#x`,
      xpath: '/html/body',
      textAnchor: label,
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      tag,
      role: tag === 'input' ? 'textbox' : 'button',
      frameUrl: null,
    },
  }
}

function row(overrides: Partial<AuditRow> & Pick<AuditRow, 'at' | 'tool'>): AuditRow {
  return {
    id: overrides.at,
    goal: 'apply to jobs',
    args: {},
    risk: 'low',
    hardBlock: null,
    decision: 'allow',
    ok: true,
    detail: '',
    ...overrides,
  }
}

const CLICK = target('Apply now', 'button')
const CITY = target('City')

describe('stepsFromRun', () => {
  it('keeps only actions that really happened', () => {
    const steps = stepsFromRun([
      row({ at: 1, tool: 'read_page', detail: '12 elements' }),
      row({ at: 2, tool: 'navigate', args: { url: 'https://example.com/jobs' } }),
      row({ at: 3, tool: 'click', args: { index: 7 }, target: CLICK, decision: 'approved' }),
      row({ at: 4, tool: 'click', args: { index: 9 }, decision: 'block', ok: false }),
      row({ at: 5, tool: 'type_text', args: { text: 'Pune' }, target: CITY, ok: false }),
      row({ at: 6, tool: 'wait', args: { seconds: 2 } }),
      row({ at: 7, tool: 'close_tabs', args: { tab_ids: [3] }, risk: 'high' }),
      row({ at: 8, tool: 'finish', args: { success: true }, ok: true }),
    ])
    expect(steps.map((step) => step.tool)).toEqual(['navigate', 'click', 'wait'])
  })

  it('forgets element indices and keeps what the step was for', () => {
    const [click] = stepsFromRun([
      row({ at: 1, tool: 'click', args: { index: 4 }, target: CLICK, detail: 'Clicked Apply now (via css).' }),
    ])
    expect(click).toMatchObject({
      tool: 'click',
      args: {},
      note: 'Clicked Apply now (via css).',
      target: { label: 'Apply now' },
    })
  })

  it('drops a click or type that never recorded its control', () => {
    const steps = stepsFromRun([
      row({ at: 1, tool: 'click', args: { index: 2 } }),
      row({ at: 2, tool: 'type_text', args: { text: 'hi' } }),
      row({ at: 3, tool: 'navigate', args: { url: 'https://a' } }),
    ])
    expect(steps.map((step) => step.tool)).toEqual(['navigate'])
  })

  it('drops a navigate row whose url argument is missing or malformed', () => {
    expect(stepsFromRun([row({ at: 1, tool: 'navigate', args: { url: 42 } })])).toEqual([])
  })

  it('collapses an action the agent had to retry', () => {
    const steps = stepsFromRun([
      row({ at: 1, tool: 'click', args: { index: 3 }, target: CLICK, detail: 'Clicked Apply now.' }),
      row({ at: 2, tool: 'click', args: { index: 3 }, target: CLICK, detail: 'Clicked Apply now.' }),
      row({ at: 3, tool: 'click', args: { index: 3 }, target: CLICK, detail: 'Clicked Apply now.' }),
    ])
    expect(steps).toHaveLength(1)
  })

  it('keeps a page scroll but not one aimed at an element', () => {
    const steps = stepsFromRun([
      row({ at: 1, tool: 'scroll', args: { direction: 'down', amount: 1.5 } }),
      row({ at: 2, tool: 'scroll', args: { direction: 'up', index: 4 } }),
    ])
    expect(steps).toEqual([
      { tool: 'scroll', args: { direction: 'down', amount: 1.5 }, note: '', target: null },
    ])
  })

  it('keeps fill_form with its profile and a submit flag', () => {
    const steps = stepsFromRun([
      row({ at: 1, tool: 'fill_form', args: { profile_id: 'p1', use_llm: true } }),
      row({ at: 2, tool: 'type_text', args: { text: 'yes', submit: true }, target: CITY }),
    ])
    expect(steps.map((step) => step.args)).toEqual([{ profile_id: 'p1' }, { text: 'yes', submit: true }])
  })
})

describe('paramsForSteps', () => {
  function typed(label: string, text: string): RecipeStep[] {
    return [{ tool: 'type_text', args: { text }, note: '', target: target(label) }]
  }

  it('turns a labelled field into a parameter named after it', () => {
    const { steps, params } = paramsForSteps(typed('Email address', 'me@example.com'))
    expect(steps[0]!.args['text']).toBe('{{email_address}}')
    expect(params).toEqual([{ name: 'email_address', label: 'Email address', sample: 'me@example.com' }])
  })

  it('numbers two fields with the same label', () => {
    const { steps, params } = paramsForSteps([
      ...typed('City', 'Pune'),
      ...typed('City', 'Mumbai'),
    ])
    expect(steps.map((step) => step.args['text'])).toEqual(['{{city}}', '{{city_2}}'])
    expect(params.map((param) => param.name)).toEqual(['city', 'city_2'])
  })

  it('leaves a value alone when the field has no usable label', () => {
    const step: RecipeStep = { tool: 'type_text', args: { text: 'x' }, note: '', target: null }
    expect(paramsForSteps([step])).toEqual({ steps: [step], params: [] })
  })

  it('leaves text that already has a parameter in it', () => {
    const step: RecipeStep = { tool: 'type_text', args: { text: '{{city}}' }, note: '', target: target('City') }
    expect(paramsForSteps([step]).params).toEqual([])
  })
})

describe('recipeFromRun', () => {
  const rows = [
    row({ at: 1, tool: 'navigate', args: { url: 'https://example.com/jobs' } }),
    row({ at: 2, tool: 'type_text', args: { text: 'React dev' }, target: target('Job title'), detail: 'Typed.' }),
    row({ at: 3, tool: 'click', args: { index: 5 }, target: CLICK, detail: 'Clicked Apply now.' }),
    row({ at: 4, tool: 'finish', args: { success: true }, detail: 'Applied.' }),
  ]

  it('builds a valid recipe with one parameter per typed field', () => {
    const recipe = recipeFromRun(rows, { name: 'Job apply', goal: 'apply to jobs', createdAt: 1000 })
    expect(recipe.steps.map((step) => step.tool)).toEqual(['navigate', 'type_text', 'click'])
    expect(recipe.params).toEqual([{ name: 'job_title', label: 'Job title', sample: 'React dev' }])
    expect(recipe.createdAt).toBe(1000)
    expect(recipe.updatedAt).toBe(1000)
    expect(recipe.schedule).toBeNull()
  })

  it('can keep the recording byte-for-byte', () => {
    const recipe = recipeFromRun(rows, {
      name: 'Job apply',
      goal: 'apply to jobs',
      parameterize: false,
      originRunId: 'abc',
    })
    expect(recipe.params).toEqual([])
    expect(recipe.steps[1]!.args['text']).toBe('React dev')
    expect(recipe.originRunId).toBe('abc')
  })

  it('refuses a run with nothing replayable', () => {
    expect(() =>
      recipeFromRun([row({ at: 1, tool: 'read_page' }), row({ at: 2, tool: 'finish' })], {
        name: 'x',
        goal: 'y',
      }),
    ).toThrow(/can be replayed/)
  })
})

describe('nameFromGoal', () => {
  it('uses the first sentence, shortened', () => {
    expect(nameFromGoal('Fill the application form. Then submit it.')).toBe('Fill the application form')
    expect(nameFromGoal('   ')).toBe('Saved workflow')
  })
})
