/**
 * Taking a picture of a tab (spec §4). Chrome's `captureVisibleTab` shoots
 * whatever is on screen in that window, so a hidden tab cannot be photographed
 * honestly and the answer is null.
 *
 * The audit log wants a 320 px thumbnail it can afford to store for every
 * step; the `screenshot` tool wants something a person can actually read, so
 * the same call runs at a larger size and a better quality.
 */

export interface Capture {
  dataUrl: string
  width: number
  height: number
}

/** Chrome throttles captureVisibleTab, and steps can fire faster than it allows. */
const MIN_CAPTURE_INTERVAL_MS = 800

/** Readable in the History panel without drowning the rest of the log. */
export const THUMB_WIDTH = 320
/** Big enough to read small text when the user asked for a screenshot. */
export const SCREENSHOT_WIDTH = 1280

let lastCaptureAt = 0

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

async function resize(dataUrl: string, maxWidth: number, quality: number): Promise<Capture | null> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
    const scale = Math.min(1, maxWidth / bitmap.width)
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    )
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    return {
      dataUrl: `data:image/jpeg;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`,
      width: canvas.width,
      height: canvas.height,
    }
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

/**
 * @param rateLimit when false the caller asked for a picture on purpose and
 * must not be silently skipped because a step fired a second earlier.
 */
export async function captureTab(tabId: number, maxWidth: number, quality: number, rateLimit = true): Promise<Capture | null> {
  const now = Date.now()
  if (rateLimit && now - lastCaptureAt < MIN_CAPTURE_INTERVAL_MS) return null
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab.active || tab.windowId === undefined) return null
    lastCaptureAt = now
    const full = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 })
    return await resize(full, maxWidth, quality)
  } catch {
    return null
  }
}

export const captureThumbnail = (tabId: number): Promise<Capture | null> =>
  captureTab(tabId, THUMB_WIDTH, 0.55)

export const captureScreenshot = (tabId: number): Promise<Capture | null> =>
  captureTab(tabId, SCREENSHOT_WIDTH, 0.8, false)
