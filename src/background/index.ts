import {
  isBackgroundMessage,
  type BackgroundMessage,
  type BackgroundResponse,
  type ContentMessage,
  type ContentResponse,
} from '@/types/messages'

/**
 * Background service worker = agent orchestrator.
 * Batches 1-2 wire up lifecycle + the side panel <-> tab message channel.
 * The agent loop, tool executor and LLM client land in later batches.
 */

chrome.runtime.onInstalled.addListener((details) => {
  // Toolbar click opens the side panel instead of a popup that closes on click.
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[navigator] sidePanel setup failed', error))

  console.info(`[navigator] ${details.reason} — service worker ready`)
})

// MV3 workers are killed when idle, so re-assert the behaviour on every startup.
chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[navigator] sidePanel setup failed', error))
})

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab || tab.id === undefined) throw new Error('No active tab found')
  return tab.id
}

function toContentMessage(message: BackgroundMessage): ContentMessage {
  if (message.kind === 'ping-active-tab') return { kind: 'ping' }
  if (message.includeOffViewport === undefined) return { kind: 'get-page-state' }
  return { kind: 'get-page-state', includeOffViewport: message.includeOffViewport }
}

async function forwardToActiveTab(message: BackgroundMessage): Promise<BackgroundResponse> {
  const tabId = await getActiveTabId()

  let response: ContentResponse
  try {
    response = (await chrome.tabs.sendMessage(tabId, toContentMessage(message))) as ContentResponse
  } catch {
    // No content script listening: the tab was open before install, or Chrome
    // refuses injection (chrome:// pages, the Web Store, PDF viewer, new tab).
    throw new Error('Content script is not running on this tab. Reload the page and try again.')
  }

  return response
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isBackgroundMessage(message)) return false

  forwardToActiveTab(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      sendResponse({ ok: false, error: text } satisfies BackgroundResponse)
    })

  // Async response — keep the message channel open.
  return true
})
