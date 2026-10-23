import { addRule, normalizeHost } from '@/safety/siteRules'
import { loadAllowlist, loadBlocklist, saveAllowlist, saveBlocklist } from '@/safety/siteRulesStore'

import type { SiteRule } from '@/safety/siteRules'

/**
 * "Allow this site" and "never act here" (spec §9), asked of the worker rather
 * than written by the panel: a card that reports the rule is saved has to mean
 * that the lists the *next* run reads really changed, and the worker is the one
 * that reads them.
 */
const LISTS: Record<SiteRule, { load: () => Promise<string[]>; save: (hosts: readonly string[]) => Promise<string[]> }> = {
  allow: { load: loadAllowlist, save: saveAllowlist },
  block: { load: loadBlocklist, save: saveBlocklist },
}

export async function addSiteRule(list: SiteRule, host: string): Promise<string[]> {
  const normalized = normalizeHost(host)
  if (normalized === '') throw new Error('That is not a site address.')
  const store = LISTS[list]
  return store.save(addRule(await store.load(), normalized))
}
