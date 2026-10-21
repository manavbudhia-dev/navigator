import { describe, expect, it } from 'vitest'

import { importRecipesJson, recipeFileJson, recipesExportJson } from './store'
import { RecipeFileSchema, RecipeSchema, type Recipe } from './types'

const RECIPE: Recipe = RecipeSchema.parse({
  id: 'job-apply',
  name: 'Apply to jobs',
  goal: 'fill the application form',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  steps: [
    { tool: 'navigate', args: { url: 'https://example.com/jobs?q={{job_title}}' }, note: 'open the board', target: null },
    {
      tool: 'click',
      args: {},
      note: 'Clicked Apply now.',
      target: {
        selector: {
          css: '#apply',
          xpath: '/html/body/button',
          textAnchor: 'Apply now',
          bbox: { x: 12, y: 34, width: 90, height: 24 },
          tag: 'button',
          role: 'button',
          frameUrl: null,
        },
        label: 'Apply now',
        role: 'button',
        inputType: null,
      },
    },
  ],
  params: [{ name: 'job_title', label: 'Job title', sample: 'React dev' }],
  schedule: { frequency: 'weekly', hour: 9, minute: 30, dayOfWeek: 1 },
  lastRun: null,
  originRunId: 'run-1',
})

describe('recipesExportJson', () => {
  it('writes a file a later import can read back', () => {
    const file = RecipeFileSchema.parse(JSON.parse(recipesExportJson([RECIPE], 1_700_000_000_500)))
    expect(file.app).toBe('navigator')
    expect(file.kind).toBe('recipes')
    expect(file.exportedAt).toBe(1_700_000_000_500)
    expect(file.recipes[0]).toEqual(RECIPE)
  })

  it('round-trips a single recipe', () => {
    const text = recipeFileJson(RECIPE)
    const file = RecipeFileSchema.parse(JSON.parse(text))
    expect(file.recipes).toHaveLength(1)
    expect(file.recipes[0]!.steps).toHaveLength(2)
  })

  it('refuses to export something that is not a recipe', () => {
    expect(() => recipesExportJson([{ ...RECIPE, steps: [] }])).toThrow()
  })
})

describe('importRecipesJson', () => {
  it('says so when the file is not JSON at all', async () => {
    await expect(importRecipesJson('Apply to jobs, 3 steps')).rejects.toThrow('That file is not JSON.')
  })

  it('says so when the JSON is not a Navigator recipe file', async () => {
    await expect(importRecipesJson(JSON.stringify({ hello: 'world' }))).rejects.toThrow(
      /Not a Navigator recipe file/,
    )
  })
})
