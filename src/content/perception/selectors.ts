/** Selector builders for multi-strategy re-resolution (spec §3a). */

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

/** Unique-ish CSS path, anchored at the nearest id and narrowed with nth-of-type. */
export function cssPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node !== null && node.nodeType === 1) {
    if (node.id) {
      parts.unshift(`#${cssEscape(node.id)}`)
      return parts.join(' > ')
    }
    const tag = node.tagName.toLowerCase()
    const parent: Element | null = node.parentElement
    if (parent !== null) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node!.tagName)
      if (siblings.length > 1) {
        parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`)
        node = parent
        continue
      }
    }
    parts.unshift(tag)
    node = parent
  }
  return parts.join(' > ')
}

export function xpathOf(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node !== null && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase()
    const parent: Element | null = node.parentElement
    if (parent !== null) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node!.tagName)
      const position = siblings.length > 1 ? `[${siblings.indexOf(node) + 1}]` : ''
      parts.unshift(`${tag}${position}`)
    } else {
      parts.unshift(tag)
    }
    node = parent
  }
  return `/${parts.join('/')}`
}

/**
 * Human-readable anchor: aria-label first, then visible text. Used as the
 * fallback strategy when the DOM mutates and positional selectors go stale.
 */
export function textAnchorOf(el: Element): string {
  const label = el.getAttribute('aria-label')?.trim()
  if (label) return label.slice(0, 80)
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 80)
  return el.getAttribute('placeholder')?.trim().slice(0, 80) ?? el.tagName.toLowerCase()
}
