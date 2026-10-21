import {
  isBackgroundMessage,
  type BackgroundMessage,
  type BackgroundResponse,
  type ContentMessage,
  type ContentResponse,
} from '@/types/messages'

import { resolveApproval, resolveQuestion, startTask, stopTask } from './task'

/**
 * Background service worker = agent orchestrator.
 * Batches 1-2 wire up lifecycle + the side panel <-> tab message channel.
 * Batch 5 adds the task router: run/stop/approve/answer live in ./task.
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
  if (message.kind === 'act-active-tab') return { kind: 'act', action: message.action }
  if (message.kind === 'get-page-state-active-tab') {
    return message.includeOffViewport === undefined
      ? { kind: 'get-page-state' }
      : { kind: 'get-page-state', includeOffViewport: message.includeOffViewport }
  }
  if (message.kind === 'set-overlay') {
    return {
      kind: 'overlay',
      ...(message.visible !== undefined ? { visible: message.visible } : {}),
      ...(message.highlightIndex !== undefined ? { highlightIndex: message.highlightIndex } : {}),
    }
  }
  throw new Error(`Not a tab message: ${message.kind}`)
}

type TaskControl = { ok: boolean; error?: string }

function control(apply: () => TaskControl): BackgroundResponse {
  const result = apply()
  return {
    ok: true,
    accepted: result.ok,
    ...(result.error !== undefined ? { error: result.error } : {}),
  }
}

function handleTaskMessage(message: BackgroundMessage): BackgroundResponse | null {
  switch (message.kind) {
    case 'stop-task':
      return control(stopTask)
    case 'approve-action':
      return control(() => resolveApproval(message.id, message.approved))
    case 'answer-question':
      return control(() => resolveQuestion(message.id, message.answer))
    default:
      return null
  }
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

  if (message.kind === 'run-task') {
    startTask(message.goal, message.mode)
      .then((result) => {
        sendResponse({
          ok: true,
          accepted: result.ok,
          ...(result.error !== undefined ? { error: result.error } : {}),
        } satisfies BackgroundResponse)
      })
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, error: text } satisfies BackgroundResponse)
      })
    return true
  }

  const taskResponse = handleTaskMessage(message)
  if (taskResponse !== null) {
    sendResponse(taskResponse)
    return false
  }

  forwardToActiveTab(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      sendResponse({ ok: false, error: text } satisfies BackgroundResponse)
    })

  // Async response — keep the message channel open.
  return true
})
