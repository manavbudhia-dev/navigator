import { z } from 'zod'

import { db, type AuditRow } from './db'

import type { TokenUsage } from '@/llm/types'

/**
 * Cost meter (spec §10): the panel already counts tokens everywhere, so this
 * only turns them into money using a price typed in Settings. Nothing is
 * invented — with no price stored the UI keeps showing tokens and says why.
 */

export const STEP_TOKEN_TARGET = 12_000
export const STEP_MS_TARGET = 2_500

const PRICING_KEY = 'pricing'

export const PricingSchema = z.object({
  /** Shown in front of every estimate, so the user can read ₹ or $ or €. */
  symbol: z.string().min(1).max(3),
  inputPerMillion: z.number().min(0),
  outputPerMillion: z.number().min(0),
})

export type Pricing = z.infer<typeof PricingSchema>

export type Usage = Pick<TokenUsage, 'promptTokens' | 'completionTokens'>

let cached: Promise<Pricing | null> | null = null

/** A panel can render twenty cost chips; the price list is still one read. */
export function pricingOnce(): Promise<Pricing | null> {
  if (cached === null) {
    const attempt = loadPricing().catch((error: unknown) => {
      // A read that threw must not stay the answer for the rest of the
      // session: drop the cache so the next panel to mount retries.
      if (cached === attempt) cached = null
      console.warn('[navigator] pricing read failed', error)
      return null
    })
    cached = attempt
  }
  return cached
}

export async function loadPricing(): Promise<Pricing | null> {
  const parsed = PricingSchema.safeParse((await db.settings.get(PRICING_KEY))?.value)
  return parsed.success ? parsed.data : null
}

/** Called after a save so the next panel to mount sees the new numbers. */
export function forgetPricing(): void {
  cached = null
}

export async function savePricing(pricing: Pricing): Promise<void> {
  await db.settings.put({ key: PRICING_KEY, value: PricingSchema.parse(pricing) })
  forgetPricing()
}

export async function clearPricing(): Promise<void> {
  await db.settings.delete(PRICING_KEY)
  forgetPricing()
}

/**
 * Everything is priced at the main model's rate. The router's cheap calls are
 * a rounding error next to a full page context per step, and a meter that
 * errs high is the useful direction.
 */
export function costOf(usage: Usage, pricing: Pricing): number {
  return (
    (usage.promptTokens * pricing.inputPerMillion + usage.completionTokens * pricing.outputPerMillion) /
    1_000_000
  )
}

export function formatCost(cost: number, symbol: string): string {
  const digits = cost < 0.01 ? 4 : cost < 1 ? 3 : 2
  return `${symbol}${cost.toFixed(digits)}`
}

/** `≈$0.041`, or null when no price has been entered. */
export function costLabel(usage: Usage, pricing: Pricing | null): string | null {
  if (pricing === null) return null
  return `≈${formatCost(costOf(usage, pricing), pricing.symbol)}`
}

export interface RunCost {
  promptTokens: number
  completionTokens: number
  /** Actions that actually ran — blocked and denied ones have no duration. */
  steps: number
  medianStepMs: number | null
  tokensPerStep: number | null
  cost: number | null
  /** Plain-language misses against the spec §12 targets. */
  over: string[]
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function summarizeRun(rows: AuditRow[], pricing: Pricing | null): RunCost {
  const durations = rows.flatMap((row) => (row.ms === undefined ? [] : [row.ms]))
  const promptTokens = rows.reduce((sum, row) => sum + (row.promptTokens ?? 0), 0)
  const completionTokens = rows.reduce((sum, row) => sum + (row.completionTokens ?? 0), 0)
  const medianStepMs = median(durations)
  const tokensPerStep =
    durations.length === 0 ? null : Math.round((promptTokens + completionTokens) / durations.length)

  const over: string[] = []
  if (medianStepMs !== null && medianStepMs > STEP_MS_TARGET) {
    over.push(`${(medianStepMs / 1000).toFixed(1)}s per step (target ${STEP_MS_TARGET / 1000}s)`)
  }
  if (tokensPerStep !== null && tokensPerStep > STEP_TOKEN_TARGET) {
    over.push(`${tokensPerStep} tokens per step (target ${STEP_TOKEN_TARGET})`)
  }

  return {
    promptTokens,
    completionTokens,
    steps: durations.length,
    medianStepMs,
    tokensPerStep,
    cost: pricing === null ? null : costOf({ promptTokens, completionTokens }, pricing),
    over,
  }
}
