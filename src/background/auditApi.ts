import type { AuditProbe } from '@/agent/loop'

/**
 * Audit evidence (spec §9): which page an action happened on, and a picture of
 * it afterwards. Everything here is best-effort — the log is a record, not a
 * dependency, so a refused or throttled capture simply leaves the field out.
 */

/** Full-size screenshots would dwarf the rest of the log; 320 px is readable in History. */
const MAX_THUMB_WIDTH = 320
/** Chrome throttles captureVisibleTab, and steps can fire faster than it allows. */
const MIN_CAPTURE_INTERVAL_MS = 800

let lastCaptureAt = 0

async function urlOf(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId)
    return tab.url ?? null
  } catch {
    return null
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

async function thumbnail(dataUrl: string): Promise<string | null> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
    const scale = Math.min(1, MAX_THUMB_WIDTH / bitmap.width)
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    )
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.55 })
    return `data:image/jpeg;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

async function screenshot(tabId: number): Promise<string | null> {
  const now = Date.now()
  if (now - lastCaptureAt < MIN_CAPTURE_INTERVAL_MS) return null
  try {
    const tab = await chrome.tabs.get(tabId)
    // captureVisibleTab shoots whatever is on screen in that window. If the
    // agent's tab is hidden, a picture of something else would be a lie.
    if (!tab.active || tab.windowId === undefined) return null
    lastCaptureAt = now
    const full = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 })
    return await thumbnail(full)
  } catch {
    return null
  }
}

export function createAuditProbe(tabId: number): AuditProbe {
  return {
    url: () => urlOf(tabId),
    thumb: () => screenshot(tabId),
  }
}
