import { z } from 'zod'

import { db } from '@/memory/db'

import { normalizeHost } from './siteRules'

/**
 * Where the site lists live: one row each in the settings table, the same home
 * as the model config and the price list. Nothing here is synced — it is this
 * browser's decision about this machine's sites.
 */

const ALLOW_KEY = 'autoAllow'
const BLOCK_KEY = 'blockedSites'

const HostListSchema = z.array(z.string())

function clean(value: unknown): string[] {
  const parsed = HostListSchema.safeParse(value)
  if (!parsed.success) return []
  return [...new Set(parsed.data.map((host) => normalizeHost(host)).filter((host) => host !== ''))].sort()
}

async function readList(key: string): Promise<string[]> {
  return clean((await db.settings.get(key))?.value)
}

/** A list that cannot be saved is still a list the panel can show. */
async function writeList(key: string, hosts: readonly string[]): Promise<string[]> {
  const next = clean(hosts)
  await db.settings.put({ key, value: next })
  return next
}

export async function loadAllowlist(): Promise<string[]> {
  return readList(ALLOW_KEY)
}

export async function saveAllowlist(hosts: readonly string[]): Promise<string[]> {
  return writeList(ALLOW_KEY, hosts)
}

export async function clearAllowlist(): Promise<void> {
  await db.settings.delete(ALLOW_KEY)
}

export async function loadBlocklist(): Promise<string[]> {
  return readList(BLOCK_KEY)
}

export async function saveBlocklist(hosts: readonly string[]): Promise<string[]> {
  return writeList(BLOCK_KEY, hosts)
}

export async function clearBlocklist(): Promise<void> {
  await db.settings.delete(BLOCK_KEY)
}
