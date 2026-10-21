import { resolveSelector } from './resolve'

import type { ElementSelector, IndexedElement } from '@/types/pageState'

/**
 * FAST-mode re-location (spec §11): the fresh index of a control that was
 * recorded on an earlier visit.
 *
 * The recorded selector is resolved against the live DOM, then matched back to
 * a snapshot entry by node identity — which is what makes this exact rather
 * than a text guess. Only entries with the same tag, role and label are
 * resolved, because asking all 400 remembered selectors to re-find themselves
 * on every step costs more than the page it describes.
 */

function sharesShape(candidate: ElementSelector, recorded: ElementSelector): boolean {
  if (candidate.tag !== recorded.tag || candidate.role !== recorded.role) return false
  if (candidate.textAnchor === '' || recorded.textAnchor === '') return true
  return candidate.textAnchor.slice(0, 24) === recorded.textAnchor.slice(0, 24)
}

export function locateRecorded(
  doc: Document,
  snapshot: readonly IndexedElement[],
  recorded: ElementSelector,
): number | null {
  const hit = resolveSelector(doc, recorded)
  if (hit === null) return null

  for (const entry of snapshot) {
    if (!sharesShape(entry.selector, recorded)) continue
    const resolved = resolveSelector(doc, entry.selector)
    if (resolved !== null && resolved.element === hit.element) return entry.index
  }
  return null
}
