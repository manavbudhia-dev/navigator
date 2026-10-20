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

function byTextAnchor(doc: Document, selector: ElementSelector): Element | null {
  const pool = Array.from(doc.querySelectorAll(selector.tag)).filter((el) => matchesAnchor(el, selector))
  if (pool.length === 0) return null
  pool.sort((a, b) => distance(rectOf(a), selector.bbox) - distance(rectOf(b), selector.bbox))
  return pool[0]!
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
 * Re-resolves a remembered selector against a possibly-mutated DOM, trying
 * strategies from cheapest/most precise to most forgiving (spec §3a).
 */
export function resolveSelector(doc: Document, selector: ElementSelector): ResolveResult | null {
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
