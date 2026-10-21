import { captureThumbnail } from './capture'

import type { AuditProbe } from '@/agent/loop'

/**
 * Audit evidence (spec §9): which page an action happened on, and a picture of
 * it afterwards. Everything here is best-effort — the log is a record, not a
 * dependency, so a refused or throttled capture simply leaves the field out.
 */

async function urlOf(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId)
    return tab.url ?? null
  } catch {
    return null
  }
}

export function createAuditProbe(tabId: number): AuditProbe {
  return {
    url: () => urlOf(tabId),
    thumb: () => captureThumbnail(tabId).then((capture) => capture?.dataUrl ?? null),
  }
}
