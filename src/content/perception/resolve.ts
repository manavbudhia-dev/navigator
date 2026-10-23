import { rectOf } from './visibility'
import type { BoundingBox, ElementSelector } from '@/types/pageState'

export type ResolveStrategy = 'css' | 'xpath' | 'text-anchor' | 'bbox'

export interface ResolveResult {
  element: Element
  strategy: ResolveStrategy
}

function center(bbox: BoundingBox): { x: number; y: number } {
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }
}

function distance(a: BoundingBox, b: BoundingBox): number {
  const ca = center(a)
  const cb = center(b)
  return Math.hypot(ca.x - cb.x, ca.y - cb.y)
}

function matchesShape(el: Element, selector: ElementSelector): boolean {
  return el.tagName.toLowerCase() === selector.tag
}

function anchorOf(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function matchesAnchor(el: Element, selector: ElementSelector): boolean {
  return anchorOf(el).startsWith(selector.textAnchor.slice(0, 40))
}

function byCss(doc: Document, selector: ElementSelector): Element | null {
  try {
    const candidates = Array.from(doc.querySelectorAll(selector.css))
    const exact = candidates.find((el) => distance(rectOf(el), selector.bbox) < 40)
    if (exact) return exact
    const single = candidates.length === 1 ? candidates[0]! : null
    return single !== null && matchesAnchor(single, selector) ? single : null
  } catch {
    return null
  }
}

function byXPath(doc: Document, selector: ElementSelector): Element | null {
  try {
    const result = doc.evaluate(selector.xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    const nodes: Element[] = []
    for (let i = 0; i < result.snapshotLength; i += 1) {
      const node = result.snapshotItem(i)
      if (node instanceof Element) nodes.push(node)
    }
    const exact = nodes.find((el) => distance(rectOf(el), selector.bbox) < 40)
    if (exact) return exact
    const single = nodes.length === 1 ? nodes[0]! : null
    return single !== null && matchesAnchor(single, selector) ? single : null
  } catch {
    return null
  }
}

/**
 * How far a forgiving strategy may reach. A cookie banner or an expanding
 * section shifts a control by tens of pixels; a footer link that happens to
 * carry the same label as the button above it is hundreds away, and clicking
 * it would be a different action than the one that was scored.
 */
const ANCHOR_RADIUS_PX = 240

function byTextAnchor(doc: Document, selector: ElementSelector): Element | null {
  const pool = Array.from(doc.querySelectorAll(selector.tag))
    .filter((el) => matchesAnchor(el, selector))
    .map((el) => ({ el, at: distance(rectOf(el), selector.bbox) }))
    .filter((candidate) => candidate.at < ANCHOR_RADIUS_PX)
  if (pool.length === 0) return null
  pool.sort((a, b) => a.at - b.at)
  return pool[0]!.el
}

function byBBox(doc: Document, selector: ElementSelector): Element | null {
  const all = Array.from(doc.querySelectorAll(selector.tag))
  let best: Element | null = null
  let bestDistance = Infinity
  for (const el of all) {
    const d = distance(rectOf(el), selector.bbox)
    if (d < bestDistance) {
      bestDistance = d
      best = el
    }
  }
  return best !== null && bestDistance < 80 ? best : null
}

/**
 * The document the remembered control was collected from. The indexer walks
 * same-origin frames from the top document and numbers everything in one
 * sequence, so a selector recorded inside a frame has to be resolved there —
 * the same css path or xpath often exists in the parent page too, and clicking
 * that would be a different control wearing the same address.
 */
function owningDocument(top: Document, frameUrl: string | null): Document | null {
  if (frameUrl === null) return top
  const matches: Document[] = []
  const visit = (doc: Document): void => {
    for (const node of Array.from(doc.querySelectorAll('iframe, frame'))) {
      let inner: Document | null = null
      try {
        inner = (node as HTMLIFrameElement).contentDocument
      } catch {
        inner = null
      }
      if (inner === null) continue
      if (inner.location?.href === frameUrl) matches.push(inner)
      if (matches.length > 1) return
      visit(inner)
    }
  }
  visit(top)
  // Two frames on the same page with the same URL: nothing identifies the one
  // the control came from, so the step is refused rather than guessed at.
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/**
 * Re-resolves a remembered selector against a possibly-mutated DOM, trying
 * strategies from cheapest/most precise to most forgiving (spec §3a).
 */
export function resolveSelector(top: Document, selector: ElementSelector): ResolveResult | null {
  const doc = owningDocument(top, selector.frameUrl)
  if (doc === null) return null

  const strategies: Array<[ResolveStrategy, (d: Document, s: ElementSelector) => Element | null]> = [
    ['css', byCss],
    ['xpath', byXPath],
    ['text-anchor', byTextAnchor],
    ['bbox', byBBox],
  ]

  for (const [name, run] of strategies) {
    const el = run(doc, selector)
    if (el !== null && matchesShape(el, selector)) return { element: el, strategy: name }
  }
  return null
}
