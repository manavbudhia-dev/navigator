import { useEffect, useState } from 'react'

import { pricingOnce, type Pricing } from '@/memory/cost'

/**
 * The price list behind every cost estimate. Reads go through one cached
 * promise, so a panel full of cost chips still costs a single database read.
 */
export function usePricing(): Pricing | null {
  const [pricing, setPricing] = useState<Pricing | null>(null)

  useEffect(() => {
    let alive = true
    void pricingOnce()
      .catch(() => null)
      .then((value) => {
        if (alive) setPricing(value)
      })
    return () => {
      alive = false
    }
  }, [])

  return pricing
}
