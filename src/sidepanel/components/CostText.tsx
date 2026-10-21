import { usePricing } from '../usePricing'
import { costLabel, type Usage } from '@/memory/cost'
import { cn } from '@/lib/utils'

/**
 * Tokens, and the money they cost once Settings holds a price. Without one the
 * meter says so instead of showing a confident ₹0.00.
 */
export function CostText({ usage, className }: { usage: Usage; className?: string }) {
  const pricing = usePricing()
  const tokens = usage.promptTokens + usage.completionTokens
  const label = costLabel(usage, pricing)
  return (
    <span className={cn('tabular-nums', className)} data-cost={label ?? 'unpriced'}>
      {tokens} tokens{label === null ? ' · no price set' : ` · ${label}`}
    </span>
  )
}
