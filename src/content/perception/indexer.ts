import { cssPath, textAnchorOf, xpathOf } from './selectors'
import { isHiddenTag, isInViewport, isVisible, rectOf } from './visibility'
import type {
  BoundingBox,
  ElementRole,
  IndexedElement,
  PageStateOptions,
} from '@/types/pageState'

const ARIA_ROLE_MAP: Record<string, ElementRole> = {
  button: 'button',
  link: 'link',
  textbox: 'textbox',
  searchbox: 'textbox',
  combobox: 'combobox',
  listbox: 'combobox',
  checkbox: 'checkbox',
  radio: 'radio',
  slider: 'slider',
  switch: 'switch',
  menuitem: 'clickable',
  tab: 'clickable',
  option: 'clickable',
}

const INPUT_ROLE_BY_TYPE: Record<string, ElementRole> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  file: 'file',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
}

export interface CollectOptions {
  includeOffViewport: boolean
  maxElements: number
  viewport: { width: number; height: number }
}

export function optionsFromPageState(options: PageStateOptions): CollectOptions {
  return {
    includeOffViewport: options.includeOffViewport,
    maxElements: options.maxElements,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

function roleOf(el: Element): ElementRole | null {
  const tag = el.tagName.toLowerCase()

  if (tag === 'a' || tag === 'area') {
    return el.hasAttribute('href') ? 'link' : null
  }
  if (tag === 'button') return 'button'
  if (tag === 'select') return 'combobox'
  if (tag === 'textarea') return 'textbox'

  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'hidden') return null
    return INPUT_ROLE_BY_TYPE[type] ?? 'textbox'
  }
  const editable = el.getAttribute('contenteditable')
  if (editable === '' || editable === 'true') return 'textbox'

  const ariaRole = el.getAttribute('role')?.toLowerCase()
  if (ariaRole && ARIA_ROLE_MAP[ariaRole]) return ARIA_ROLE_MAP[ariaRole]

  // No semantic role: treat as clickable only when the page styles or wires it
  // that way (cursor:pointer, focusable, or an inline handler).
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el)
  const cursorPointer = style?.cursor === 'pointer'
  const focusable = (Number(el.getAttribute('tabindex')) || 0) >= 0 && el.hasAttribute('tabindex')
  const hasInlineHandler = el.hasAttribute('onclick')
  if (cursorPointer || focusable || hasInlineHandler) return 'clickable'

  return null
}

function isActionable(el: Element): boolean {
  // `disabled` lives on the form-control interfaces; a duck-typed read also
  // covers same-shaped elements coming from other frames' windows.
  const formControl = el as Element & { disabled?: boolean }
  if (formControl.disabled === true) return false
  if (el instanceof HTMLElement && el.inert) return false
  if (el.getAttribute('aria-disabled') === 'true') return false
  return true
}

const ATTRIBUTE_WHITELIST = [
  'aria-label',
  'placeholder',
  'type',
  'name',
  'id',
  'href',
  'value',
  'role',
  'title',
  'alt',
] as const

function attributesOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ATTRIBUTE_WHITELIST) {
    const value = el.getAttribute(key)
    if (value !== null && value.trim() !== '') out[key] = value.trim().slice(0, 120)
  }
  const className = typeof el.className === 'string' ? el.className.trim() : ''
  if (className !== '') out.class = className.replace(/\s+/g, ' ').slice(0, 48)
  return out
}

function visibleTextOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

interface WalkContext {
  elements: IndexedElement[]
  options: CollectOptions
  frameUrl: string | null
  hitCap: boolean
}

function pushElement(ctx: WalkContext, el: Element, role: ElementRole, bbox: BoundingBox): void {
  const index = ctx.elements.length
  ctx.elements.push({
    index,
    tag: el.tagName.toLowerCase(),
    role,
    attributes: attributesOf(el),
    text: visibleTextOf(el),
    bbox,
    inViewport: isInViewport(bbox, ctx.options.viewport),
    selector: {
      css: cssPath(el),
      xpath: xpathOf(el),
      textAnchor: textAnchorOf(el),
      bbox,
      tag: el.tagName.toLowerCase(),
      role,
      frameUrl: ctx.frameUrl,
    },
  })
  if (ctx.elements.length >= ctx.options.maxElements) ctx.hitCap = true
}

function walk(ctx: WalkContext, root: ParentNode): void {
  if (ctx.hitCap) return

  const children = root.children ? Array.from(root.children) : []
  for (const el of children) {
    if (ctx.hitCap) return
    const tag = el.tagName.toLowerCase()

    if (!isHiddenTag(tag)) {
      const role = roleOf(el)
      if (role !== null && isActionable(el)) {
        const bbox = rectOf(el)
        if (isVisible(el, bbox) && (ctx.options.includeOffViewport || isInViewport(bbox, ctx.options.viewport))) {
          pushElement(ctx, el, role, bbox)
          if (ctx.hitCap) return
        }
      }
    }

    if (el.shadowRoot) {
      walk(ctx, el.shadowRoot)
      if (ctx.hitCap) return
    }

    if (tag === 'iframe' || tag === 'frame') {
      const doc = frameDocument(el as HTMLIFrameElement)
      if (doc) {
        const frameCtx: WalkContext = { ...ctx, frameUrl: doc.location?.href ?? ctx.frameUrl }
        walk(frameCtx, doc)
        ctx.hitCap = frameCtx.hitCap
        if (ctx.hitCap) return
      }
    }

    walk(ctx, el)
  }
}

function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument
  } catch {
    return null
  }
}

/**
 * Builds the interactive element map in document order (shadow roots and
 * same-origin iframes inlined at their host position). Indices are stable for
 * the lifetime of one snapshot.
 */
export function collectInteractiveElements(
  root: Document,
  options: CollectOptions,
): { elements: IndexedElement[]; hitCap: boolean } {
  const ctx: WalkContext = { elements: [], options, frameUrl: null, hitCap: false }
  walk(ctx, root)
  return { elements: ctx.elements, hitCap: ctx.hitCap }
}

/** `[12]<button aria-label="Search" class="hdr-btn">Search</button>` */
export function serializeElement(el: IndexedElement): string {
  const attrs = Object.entries(el.attributes)
    .map(([key, value]) => ` ${key}="${value.replace(/"/g, "'")}"`)
    .join('')
  const text = el.text ? `>${el.text}<` : '><'
  return `[${el.index}]<${el.tag}${attrs}${text}/${el.tag}>`
}
