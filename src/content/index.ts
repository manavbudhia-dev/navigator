import { performAct } from './actions'
import { readArticleWithLinks } from './article'
import { readFormFields } from './formFields'
import { highlightElement, markForReview, setOverlay } from './overlay'
import { buildPageState, getSnapshot } from './perception/pageState'
import {
  isContentMessage,
  type ContentResponse,
  type PageMeta,
} from '@/types/messages'
import { DEFAULT_PAGE_STATE_OPTIONS } from '@/types/pageState'

/**
 * Content script — perception + action performer.
 * Batch 2 added the full Page State snapshot; Batch 4 adds action execution.
 */

function readPageMeta(): PageMeta {
  const doc = document.documentElement
  const scrollable = doc.scrollHeight - window.innerHeight
  const scrollPercent = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0

  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    scrollPercent: Math.round(scrollPercent * 10) / 10,
    pageHeightPx: doc.scrollHeight,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

function readOverlay(
  visible: boolean | undefined,
  highlightIndex: number | undefined,
  review: number[] | undefined,
): ContentResponse {
  const details: string[] = []
  let error: string | null = null

  // setOverlay rebuilds the layer, so it goes first; the marks below paint on top.
  if (visible !== undefined) {
    const result = setOverlay(visible)
    if (result.ok) details.push(result.detail)
    else error = error ?? result.error
  }
  if (highlightIndex !== undefined) {
    const result = highlightElement(highlightIndex)
    if (result.ok) details.push(result.detail)
    else error = result.error
  }
  if (review !== undefined) {
    const result = markForReview(review)
    if (result.ok) details.push(result.detail)
    else error = error ?? result.error
  }

  if (details.length > 0) return { ok: true, detail: details.join(' · ') }
  return { ok: false, error: error ?? 'Overlay message had nothing to apply.' }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isContentMessage(message)) return false

  let response: ContentResponse
  if (message.kind === 'ping') {
    response = { ok: true, meta: readPageMeta() }
  } else if (message.kind === 'act') {
    response = performAct(message.action)
  } else if (message.kind === 'overlay') {
    response = readOverlay(message.visible, message.highlightIndex, message.review)
  } else if (message.kind === 'get-form-fields') {
    response = { ok: true, fields: readFormFields(document, getSnapshot()) }
  } else if (message.kind === 'get-article') {
    response = { ok: true, article: readArticleWithLinks(document) }
  } else {
    const pageState = buildPageState(document, {
      ...DEFAULT_PAGE_STATE_OPTIONS,
      includeOffViewport: message.includeOffViewport ?? DEFAULT_PAGE_STATE_OPTIONS.includeOffViewport,
    })
    response = { ok: true, pageState }
  }

  sendResponse(response)
  return false
})
