import { buildPageState, getSnapshot } from './perception/pageState'
import { resolveSelector } from './perception/resolve'
import { rectOf } from './perception/visibility'
import { DEFAULT_PAGE_STATE_OPTIONS } from '@/types/pageState'
import type { ActResult } from '@/types/actions'
import type { BoundingBox } from '@/types/pageState'

/**
 * Visual feedback for humans: numbered boxes over every element the agent can
 * see, plus a pulsing ring on the element it is about to touch. The layer
 * never receives pointer events, so the page stays fully usable while it is on.
 */

const LAYER_ID = 'navigator-overlay'
const STYLE_ID = 'navigator-overlay-style'
const MAX_BOXES = 100
const HIGHLIGHT_MS = 1500

const CSS = `
#${LAYER_ID} { position: fixed; left: 0; top: 0; right: 0; bottom: 0; pointer-events: none; z-index: 2147483646; }
#${LAYER_ID} .nav-box { position: absolute; box-sizing: border-box; border: 1.5px solid #6366f1; background: rgba(99, 102, 241, 0.08); }
#${LAYER_ID} .nav-tag { position: absolute; left: 0; top: -8px; min-width: 16px; padding: 0 3px; border-radius: 3px; background: #6366f1; color: #fff; font: 700 10px/16px ui-sans-serif, system-ui, sans-serif; text-align: center; }
#${LAYER_ID} .nav-pulse { position: absolute; box-sizing: border-box; border: 3px solid #f59e0b; animation: nav-pulse 1.2s ease-out infinite; }
#${LAYER_ID} .nav-review { position: absolute; box-sizing: border-box; border: 2px dashed #dc2626; background: rgba(220, 38, 38, 0.08); }
#${LAYER_ID} .nav-review .nav-tag { background: #dc2626; }
@keyframes nav-pulse { 0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.6); } 100% { box-shadow: 0 0 0 16px rgba(245, 158, 11, 0); } }
`

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  doc.head.append(style)
}

function layerOf(doc: Document, create: boolean): HTMLElement | null {
  const found = doc.getElementById(LAYER_ID)
  if (found instanceof HTMLElement) return found
  if (!create) return null
  const host = doc.body ?? doc.documentElement
  if (!host) return null
  const layer = doc.createElement('div')
  layer.id = LAYER_ID
  host.append(layer)
  return layer
}

function onScreen(box: BoundingBox): boolean {
  if (box.width <= 0 || box.height <= 0) return false
  return box.y + box.height > 0 && box.y < window.innerHeight
}

/** Re-resolves the remembered snapshot against the live DOM and keeps what is visible now. */
function mappedRects(doc: Document): Array<{ index: number; box: BoundingBox }> {
  const out: Array<{ index: number; box: BoundingBox }> = []
  for (const el of getSnapshot()) {
    const resolved = resolveSelector(doc, el.selector)
    if (!resolved) continue
    const box = rectOf(resolved.element)
    if (!onScreen(box)) continue
    out.push({ index: el.index, box })
    if (out.length >= MAX_BOXES) break
  }
  return out
}

function boxStyle(box: BoundingBox): string {
  return `left: ${box.x}px; top: ${box.y}px; width: ${box.width}px; height: ${box.height}px`
}

/** The overlay works from the last Page State snapshot; take one if nobody has yet. */
function ensureSnapshot(doc: Document): void {
  if (getSnapshot().length === 0) buildPageState(doc, DEFAULT_PAGE_STATE_OPTIONS)
}

export function setOverlay(visible: boolean): ActResult {
  const doc = document
  ensureStyle(doc)

  if (!visible) {
    doc.getElementById(LAYER_ID)?.remove()
    return { ok: true, detail: 'Overlay off' }
  }

  ensureSnapshot(doc)
  const rects = mappedRects(doc)
  if (rects.length === 0) return { ok: false, error: 'No visible elements to highlight on this page.' }

  const layer = layerOf(doc, true)
  if (!layer) return { ok: false, error: 'This page has no body element to attach the overlay to.' }

  layer.replaceChildren()
  for (const { index, box } of rects) {
    const el = doc.createElement('div')
    el.className = 'nav-box'
    el.style.cssText = boxStyle(box)
    const tag = doc.createElement('span')
    tag.className = 'nav-tag'
    tag.textContent = String(index)
    el.append(tag)
    layer.append(el)
  }
  return { ok: true, detail: `Overlay showing ${rects.length} element${rects.length === 1 ? '' : 's'}` }
}

export function highlightElement(index: number): ActResult {
  const doc = document
  ensureStyle(doc)

  const entry = getSnapshot().find((el) => el.index === index)
  if (!entry) return { ok: false, error: `No snapshot element with index ${index}.` }

  const resolved = resolveSelector(doc, entry.selector)
  if (!resolved) return { ok: false, error: `Element ${index} is no longer on the page.` }

  let box = rectOf(resolved.element)
  if (box.width <= 0 || box.height <= 0) return { ok: false, error: `Element ${index} has no size.` }
  if (box.y + box.height < 0 || box.y > window.innerHeight) {
    if (typeof resolved.element.scrollIntoView === 'function') {
      resolved.element.scrollIntoView({ block: 'center' })
    }
    box = rectOf(resolved.element)
  }

  const layer = layerOf(doc, true)
  if (!layer) return { ok: false, error: 'This page has no body element to attach the overlay to.' }

  const pulse = doc.createElement('div')
  pulse.className = 'nav-pulse'
  pulse.style.cssText = `left: ${box.x - 2}px; top: ${box.y - 2}px; width: ${box.width + 4}px; height: ${box.height + 4}px`
  layer.append(pulse)
  setTimeout(() => pulse.remove(), HIGHLIGHT_MS)
  return { ok: true, detail: `Highlighting element ${index} (${entry.tag})` }
}

/**
 * Red dashed boxes on fields the agent deliberately did not touch — payment,
 * consent, captcha, upload — so the human knows what is left (spec §6).
 */
export function markForReview(indices: number[]): ActResult {
  const doc = document
  ensureStyle(doc)
  const layer = layerOf(doc, true)
  if (!layer) return { ok: false, error: 'This page has no body element to attach the overlay to.' }

  for (const existing of layer.querySelectorAll('.nav-review')) existing.remove()

  let marked = 0
  ensureSnapshot(doc)
  const snapshot = getSnapshot()
  for (const index of indices) {
    const entry = snapshot.find((el) => el.index === index)
    if (!entry) continue
    const resolved = resolveSelector(doc, entry.selector)
    if (!resolved) continue
    const box = rectOf(resolved.element)
    if (box.width <= 0 || box.height <= 0) continue

    const el = doc.createElement('div')
    el.className = 'nav-review'
    el.style.cssText = boxStyle(box)
    const tag = doc.createElement('span')
    tag.className = 'nav-tag'
    tag.textContent = '!'
    el.append(tag)
    layer.append(el)
    marked += 1
  }

  return { ok: true, detail: `Marked ${marked} field${marked === 1 ? '' : 's'} for review` }
}
