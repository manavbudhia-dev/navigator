import { z } from 'zod'

import { db } from '@/memory/db'

import { normalizeHost } from './allowlist'

/**
 * Where Auto mode's site list lives: one row in the settings table, the same
 * home as the model config and the price list. Nothing here is synced — it is
 * this browser's decision about this machine's sites.
 */

const ALLOWLIST_KEY = 'autoAllow'

const AllowlistSchema = z.array(z.string())

function clean(value: unknown): string[] {
  const parsed = AllowlistSchema.safeParse(value)
  if (!parsed.success) return []
  return [...new Set(parsed.data.map((host) => normalizeHost(host)).filter((host) => host !== ''))].sort()
}

export async function loadAllowlist(): Promise<string[]> {
  const row = await db.settings.get(ALLOWLIST_KEY)
  return clean(row?.value)
}

/** A list that cannot be saved is still a list the panel can show. */
export async function saveAllowlist(hosts: readonly string[]): Promise<string[]> {
  const next = clean(hosts)
  await db.settings.put({ key: ALLOWLIST_KEY, value: next })
  return next
}

export async function clearAllowlist(): Promise<void> {
  await db.settings.delete(ALLOWLIST_KEY)
}
