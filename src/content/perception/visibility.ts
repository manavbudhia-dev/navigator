import type { BoundingBox } from '@/types/pageState'

const HIDDEN_TAGS = new Set([
  'html',
  'body',
  'head',
  'script',
  'style',
  'meta',
  'link',
  'template',
  'noscript',
  'svg',
  'canvas',
])

export function isHiddenTag(tag: string): boolean {
  return HIDDEN_TAGS.has(tag)
}

export function rectOf(el: Element): BoundingBox {
  const rect = el.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

export function hasArea(bbox: BoundingBox): boolean {
  return bbox.width > 0 && bbox.height > 0
}

export function isInViewport(bbox: BoundingBox, viewport: { width: number; height: number }): boolean {
  return (
    bbox.y + bbox.height > 0 &&
    bbox.y < viewport.height &&
    bbox.x + bbox.width > 0 &&
    bbox.x < viewport.width
  )
}

/**
 * Visibility per spec §3a: display:none, visibility:hidden, opacity:0 (own or
 * inherited through ancestors), zero size, aria-hidden and inert all exclude.
 * Chrome exposes checkVisibility(); the manual walk covers older engines and
 * test environments.
 */
export function isVisible(el: Element, bbox: BoundingBox): boolean {
  if (!hasArea(bbox)) return false
  if (el.closest('[aria-hidden="true"]') !== null) return false
  if (el.closest('[inert]') !== null) return false

  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  }

  let node: Element | null = el
  let depth = 0
  while (node !== null && node !== node.ownerDocument?.documentElement && depth < 12) {
    const style = node.ownerDocument?.defaultView?.getComputedStyle(node)
    if (!style) return true
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false
    }
    node = node.parentElement
    depth += 1
  }
  return true
}
