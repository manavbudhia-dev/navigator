/** Semantic role of an interactive element, mirroring ARIA where possible. */
export const ELEMENT_ROLES = [
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'slider',
  'switch',
  'file',
  'clickable',
] as const

export type ElementRole = (typeof ELEMENT_ROLES)[number]

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Multi-strategy locator kept off the wire: the LLM only ever sees the
 * serialized `[12]<button …>…</button>` line, never these selectors.
 */
export interface ElementSelector {
  css: string
  xpath: string
  textAnchor: string
  bbox: BoundingBox
  tag: string
  role: ElementRole
  frameUrl: string | null
}

export interface IndexedElement {
  index: number
  tag: string
  role: ElementRole
  attributes: Record<string, string>
  text: string
  bbox: BoundingBox
  inViewport: boolean
  selector: ElementSelector
}

export type LoginState = 'unknown' | 'login-form' | 'logged-in'

/** The compact, LLM-facing snapshot of one tab at one moment. */
export interface PageState {
  url: string
  title: string
  readyState: string
  scrollPercent: number
  pageHeightPx: number
  viewport: { width: number; height: number }
  loginState: LoginState
  elementLines: string[]
  elementCount: number
  inViewportCount: number
  markdown: string
  truncatedElements: boolean
  truncatedMarkdown: boolean
  tokenEstimate: number
  capturedAt: number
}

export interface PageStateOptions {
  includeOffViewport: boolean
  maxElements: number
  tokenBudget: number
}

export const DEFAULT_PAGE_STATE_OPTIONS: PageStateOptions = {
  includeOffViewport: true,
  maxElements: 400,
  tokenBudget: 4000,
}
