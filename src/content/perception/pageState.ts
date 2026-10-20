import { applyTokenBudget } from './budget'
import { extractMarkdown } from './extract'
import { collectInteractiveElements, serializeElement } from './indexer'
import type {
  IndexedElement,
  LoginState,
  PageState,
  PageStateOptions,
} from '@/types/pageState'

/** Latest snapshot, kept content-script-side so later actions can re-resolve
 *  `[12]` indices against selectors that never leave this context. */
let lastSnapshot: IndexedElement[] = []

export function getSnapshot(): readonly IndexedElement[] {
  return lastSnapshot
}

const LOGOUT_PATTERN = /\b(sign|log)[\s-]?out\b|\blogout\b/i

export function detectLoginState(doc: Document): LoginState {
  if (doc.querySelector('input[type="password"]') !== null) return 'login-form'
  const links = Array.from(doc.querySelectorAll('a, button'))
  const hasLogout = links.some((el) => {
    const text = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`
    return LOGOUT_PATTERN.test(text)
  })
  return hasLogout ? 'logged-in' : 'unknown'
}

function metaTextOf(state: Omit<PageState, 'elementLines' | 'markdown' | 'tokenEstimate' | 'truncatedElements' | 'truncatedMarkdown'>): string {
  return [
    `URL: ${state.url}`,
    `Title: ${state.title}`,
    `Scroll: ${state.scrollPercent}% of ${state.pageHeightPx}px`,
    `Viewport: ${state.viewport.width}x${state.viewport.height}`,
    `Login: ${state.loginState}`,
  ].join('\n')
}

/** Builds the compact Page State object for one step (spec §3). */
export function buildPageState(doc: Document, options: PageStateOptions): PageState {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const { elements, hitCap } = collectInteractiveElements(doc, {
    includeOffViewport: options.includeOffViewport,
    maxElements: options.maxElements,
    viewport,
  })
  lastSnapshot = elements

  const docEl = doc.documentElement
  const scrollable = docEl.scrollHeight - window.innerHeight
  const scrollPercent = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0

  const base = {
    url: location.href,
    title: doc.title,
    readyState: doc.readyState,
    scrollPercent: Math.round(scrollPercent * 10) / 10,
    pageHeightPx: docEl.scrollHeight,
    viewport,
    loginState: detectLoginState(doc),
    elementCount: elements.length,
    inViewportCount: elements.filter((el) => el.inViewport).length,
    capturedAt: Date.now(),
  }

  const budgeted = applyTokenBudget({
    elements,
    serialize: serializeElement,
    markdown: extractMarkdown(doc),
    metaText: metaTextOf(base),
    budget: options.tokenBudget,
  })

  return {
    ...base,
    elementLines: budgeted.elementLines,
    markdown: budgeted.markdown,
    truncatedElements: budgeted.truncatedElements || hitCap,
    truncatedMarkdown: budgeted.truncatedMarkdown,
    tokenEstimate: budgeted.tokenEstimate,
  }
}
