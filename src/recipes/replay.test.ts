import { describe, expect, it, vi } from 'vitest'

import { replayRecipe, startUrl, type ReplayDeps } from './replay'
import type { ElementTarget, Recipe, RecipeStep } from './types'

const TARGET: ElementTarget = {
  selector: {
    css: '#apply',
    xpath: '/html/body/button',
    textAnchor: 'Apply now',
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    tag: 'button',
    role: 'button',
    frameUrl: null,
  },
  label: 'Apply now',
  role: 'button',
  inputType: null,
}

function step(overrides: Partial<RecipeStep> & Pick<RecipeStep, 'tool'>): RecipeStep {
  return { args: {}, note: `${overrides.tool} step`, target: null, ...overrides }
}

function recipe(steps: RecipeStep[]): Recipe {
  const at = 1_700_000_000_000
  return {
    id: 'r1',
    name: 'Apply',
    goal: 'apply to the job',
    createdAt: at,
    updatedAt: at,
    steps,
    params: [],
    schedule: null,
    lastRun: null,
    originRunId: null,
  }
}

interface Spy {
  deps: ReplayDeps
  calls: string[]
  refresh: ReturnType<typeof vi.fn>
  findIndex: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
  permit: ReturnType<typeof vi.fn>
  heal: ReturnType<typeof vi.fn>
}

function spy(overrides: Partial<ReplayDeps> = {}): Spy {
  const calls: string[] = []
  const deps: ReplayDeps = {
    refresh: vi.fn(async () => {
      calls.push('refresh')
    }),
    findIndex: vi.fn(async () => 3),
    execute: vi.fn(async () => {
      calls.push('execute')
      return { ok: true, content: 'done' }
    }),
    permit: vi.fn(async () => true),
    heal: vi.fn(async () => {
      calls.push('heal')
      return 'the model found a different button'
    }),
    ...overrides,
  }
  return { deps, calls, ...deps } as unknown as Spy
}

const VALUES = { city: 'Pune' }

describe('replayRecipe', () => {
  it('replays every step from the recording without asking the model', async () => {
    const s = spy()
    const result = await replayRecipe(
      recipe([step({ tool: 'navigate', args: { url: 'https://x/jobs?city={{city}}' } }), step({ tool: 'click', target: TARGET })]),
      VALUES,
      s.deps,
    )
    expect(result.ok).toBe(true)
    expect(result.healed).toBe(0)
    expect(result.detail).toBe('2 step(s) replayed as recorded.')
    expect(result.steps.map((entry) => entry.mode)).toEqual(['recorded', 'recorded'])
    expect(s.calls).toEqual(['refresh', 'execute', 'refresh', 'execute'])
  })

  it('hands the executor the filled-in arguments', async () => {
    const s = spy()
    await replayRecipe(recipe([step({ tool: 'navigate', args: { url: 'https://x/{{city}}' } })]), VALUES, s.deps)
    const [stepArg, index] = s.execute.mock.calls[0] as [RecipeStep, number | null]
    expect(stepArg.args).toEqual({ url: 'https://x/Pune' })
    expect(index).toBeNull()
  })

  it('passes the freshly located index for a step with a target', async () => {
    const s = spy({ findIndex: vi.fn(async () => 11) })
    await replayRecipe(recipe([step({ tool: 'click', target: TARGET })]), VALUES, s.deps)
    expect(s.findIndex.mock.calls[0]![0]).toBe(TARGET)
    expect((s.execute.mock.calls[0] as [RecipeStep, number | null])[1]).toBe(11)
  })

  it('asks the model only about the step whose control disappeared', async () => {
    const s = spy({
      findIndex: vi.fn(async (target: ElementTarget) => (target.label === 'Apply now' ? null : 4)),
    })
    const result = await replayRecipe(
      recipe([
        step({ tool: 'click', target: TARGET }),
        step({ tool: 'type_text', args: { text: '{{city}}' }, target: { ...TARGET, label: 'City' } }),
      ]),
      VALUES,
      s.deps,
    )
    expect(result.healed).toBe(1)
    expect(result.ok).toBe(true)
    expect(result.steps.map((entry) => entry.mode)).toEqual(['healed', 'recorded'])
    expect(s.heal).toHaveBeenCalledTimes(1)
    expect(s.calls).toEqual(['refresh', 'heal', 'refresh', 'execute'])
  })

  it('stops when the model cannot rescue a dead step', async () => {
    const s = spy({ findIndex: vi.fn(async () => null), heal: vi.fn(async () => null) })
    const result = await replayRecipe(recipe([step({ tool: 'click', target: TARGET })]), VALUES, s.deps)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('"Apply now"')
    expect(result.steps).toEqual([])
    expect(s.execute).not.toHaveBeenCalled()
  })

  it('heals a step that was found but failed to run', async () => {
    const s = spy({
      execute: vi.fn(async () => ({ ok: false, content: 'The click was ignored.' })),
    })
    const result = await replayRecipe(recipe([step({ tool: 'click', target: TARGET })]), VALUES, s.deps)
    expect(result.ok).toBe(true)
    expect(result.healed).toBe(1)
    expect(result.steps[0]).toMatchObject({ mode: 'healed', detail: 'the model found a different button' })
  })

  it('does not waste a model call on a step that points at nothing', async () => {
    const s = spy({ execute: vi.fn(async () => ({ ok: false, content: 'too fast' })) })
    const result = await replayRecipe(recipe([step({ tool: 'wait', args: { seconds: 1 } })]), VALUES, s.deps)
    expect(result.ok).toBe(false)
    expect(s.heal).not.toHaveBeenCalled()
    expect(result.detail).toContain('failed: too fast')
  })

  it('stops at a step the safety gate refuses', async () => {
    const s = spy({ permit: vi.fn(async (stepArg: RecipeStep) => stepArg.tool !== 'click') })
    const result = await replayRecipe(
      recipe([step({ tool: 'wait', args: { seconds: 1 } }), step({ tool: 'click', target: TARGET })]),
      VALUES,
      s.deps,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('declined step 2')
    expect(result.steps.map((entry) => entry.mode)).toEqual(['recorded', 'denied'])
  })

  it('stops when the user hits the kill switch', async () => {
    const controller = new AbortController()
    const s = spy({
      execute: vi.fn(async () => {
        controller.abort()
        return { ok: true, content: 'done' }
      }),
    })
    const result = await replayRecipe(
      recipe([step({ tool: 'click', target: TARGET }), step({ tool: 'click', target: TARGET })]),
      VALUES,
      { ...s.deps, signal: controller.signal },
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Stopped by the user after 1 step')
    expect(s.execute).toHaveBeenCalledTimes(1)
  })

  it('refuses to start when a parameter has no value', async () => {
    const s = spy()
    await expect(
      replayRecipe(recipe([step({ tool: 'type_text', args: { text: '{{city}}' }, target: TARGET })]), {}, s.deps),
    ).rejects.toThrow(/needs values for: city/)
    expect(s.refresh).not.toHaveBeenCalled()
  })
})

describe('startUrl', () => {
  it('takes the first recorded navigate and fills in its variables', () => {
    const r = recipe([
      step({ tool: 'click', target: TARGET }),
      step({ tool: 'navigate', args: { url: 'https://example.com/{{city}}' } }),
      step({ tool: 'navigate', args: { url: 'https://other.example' } }),
    ])
    expect(startUrl(r, { city: 'Pune' })).toBe('https://example.com/Pune')
  })

  it('has no start page for a recipe that never navigates', () => {
    expect(startUrl(recipe([step({ tool: 'click', target: TARGET })]), {})).toBeNull()
    expect(startUrl(recipe([step({ tool: 'navigate', args: { url: '' } })]), {})).toBeNull()
  })
})
