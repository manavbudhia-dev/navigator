import { isContentMessage, type ContentResponse, type PageMeta } from '@/types/messages'

/**
 * Content script — perception + action performer.
 * Batch 1 returns page metadata only; the interactive element map, markdown
 * extraction and action execution arrive in Batch 2 and Batch 4.
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

  const response: ContentResponse = { ok: true, meta: readPageMeta() }
  sendResponse(response)
  return false
})
