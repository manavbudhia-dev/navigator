import { addRule, normalizeHost } from '@/safety/siteRules'
import { loadAllowlist, saveAllowlist } from '@/safety/siteRulesStore'

/**
 * "Allow this site" (spec §9), asked of the worker rather than written by the
 * panel: a card that reports the site is allowed has to mean that the list the
 * *next* run reads really changed, and the worker is the one that reads it.
 */
export async function allowSite(host: string): Promise<string[]> {
  const normalized = normalizeHost(host)
  if (normalized === '') throw new Error('That is not a site address.')
  return saveAllowlist(addRule(await loadAllowlist(), normalized))
}
