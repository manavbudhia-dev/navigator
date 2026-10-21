import { describe, expect, it } from 'vitest'

import {
  costLabel,
  costOf,
  formatCost,
  STEP_MS_TARGET,
  summarizeRun,
  type Pricing,
} from './cost'
import type { AuditRow } from './db'

const DOLLAR: Pricing = { symbol: '$', inputPerMillion: 2, outputPerMillion: 8 }
const RUPEE: Pricing = { symbol: '₹', inputPerMillion: 100, outputPerMillion: 400 }

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    at: 0,
    goal: 'g',
    tool: 'click',
    args: {},
    risk: 'safe',
    hardBlock: null,
    decision: 'allow',
    ok: true,
    detail: '',
    ...overrides,
  }
}

describe('costOf', () => {
  it('prices a million tokens at the rate per million', () => {
    expect(costOf({ promptTokens: 1_000_000, completionTokens: 0 }, DOLLAR)).toBeCloseTo(2)
    expect(costOf({ promptTokens: 0, completionTokens: 1_000_000 }, DOLLAR)).toBeCloseTo(8)
    expect(costOf({ promptTokens: 500_000, completionTokens: 250_000 }, DOLLAR)).toBeCloseTo(3)
  })

  it('keeps the currency the user typed', () => {
    expect(costLabel({ promptTokens: 1_000_000, completionTokens: 0 }, RUPEE)).toBe('≈₹100.00')
  })

  it('refuses to invent a price', () => {
    expect(costLabel({ promptTokens: 999_999, completionTokens: 999_999 }, null)).toBeNull()
  })
})

describe('formatCost', () => {
  it('shows enough digits that a cheap run is not zero', () => {
    expect(formatCost(0.0004, '$')).toBe('$0.0004')
    expect(formatCost(0.5, '$')).toBe('$0.500')
    expect(formatCost(12.5, '$')).toBe('$12.50')
  })
})

describe('summarizeRun', () => {
  it('adds up tokens and prices the run', () => {
    const summary = summarizeRun(
      [
        row({ ms: 100, promptTokens: 1000, completionTokens: 10 }),
        row({ ms: 200, promptTokens: 2000, completionTokens: 20 }),
      ],
      DOLLAR,
    )
    expect(summary.promptTokens).toBe(3000)
    expect(summary.completionTokens).toBe(30)
    expect(summary.cost).toBeCloseTo(0.006)
    expect(summary.over).toEqual([])
  })

  it('counts only actions that ran, because a blocked one never took time', () => {
    const summary = summarizeRun(
      [row({ ms: 100 }), row({ decision: 'block', ok: false }), row({})],
      DOLLAR,
    )
    expect(summary.steps).toBe(1)
    expect(summary.medianStepMs).toBe(100)
  })

  it('uses the median, so one slow page load does not condemn the run', () => {
    const summary = summarizeRun([row({ ms: 50 }), row({ ms: 60 }), row({ ms: 9000 })], null)
    expect(summary.medianStepMs).toBe(60)
    expect(summary.cost).toBeNull()
  })

  it('flags a run that misses the spec targets', () => {
    const slow = summarizeRun([row({ ms: STEP_MS_TARGET + 1000 })], DOLLAR)
    expect(slow.over.join(' ')).toContain('s per step')

    const thirsty = summarizeRun(
      Array.from({ length: 3 }, () => row({ ms: 10, promptTokens: 20_000 })),
      DOLLAR,
    )
    expect(thirsty.over.join(' ')).toContain('tokens per step')
  })

  it('handles a run with nothing to measure', () => {
    expect(summarizeRun([], DOLLAR)).toMatchObject({
      steps: 0,
      medianStepMs: null,
      tokensPerStep: null,
      cost: 0,
      over: [],
    })
  })
})
