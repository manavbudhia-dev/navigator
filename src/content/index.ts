import { buildPageState } from './perception/pageState'
import {
  isContentMessage,
  type ContentResponse,
  type PageMeta,
} from '@/types/messages'
import { DEFAULT_PAGE_STATE_OPTIONS } from '@/types/pageState'

/**
 * Content script — perception + action performer.
 * Batch 2 adds the full Page State snapshot; action execution arrives in
 * Batch 4.
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isContentMessage(message)) return false

  if (message.kind === 'ping') {
    const response: ContentResponse = { ok: true, meta: readPageMeta() }
    sendResponse(response)
    return false
  }

  const pageState = buildPageState(document, {
    ...DEFAULT_PAGE_STATE_OPTIONS,
    includeOffViewport: message.includeOffViewport ?? DEFAULT_PAGE_STATE_OPTIONS.includeOffViewport,
  })
  const response: ContentResponse = { ok: true, pageState }
  sendResponse(response)
  return false
})
