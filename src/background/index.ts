import type { ArticlePayload } from '@/research/types'
import {
  isBackgroundMessage,
  type BackgroundMessage,
  type BackgroundResponse,
  type ContentMessage,
  type ContentResponse,
} from '@/types/messages'

import { handleVaultRequest } from './vaultApi'
import { researchFollowup, startResearch, stopResearch } from './research'
import { restoreSchedules, scheduleRecipe, startRecipeRun, unscheduleRecipe } from './recipeRun'
import { runTabCommand, runTabIntent, startTabWatchers } from './tabApi'
import { resolveApproval, resolveQuestion, stopRun } from './runControl'
import { startTask } from './task'

/**
 * Background service worker = agent orchestrator.
 * Batches 1-2 wire up lifecycle + the side panel <-> tab message channel.
 * Batch 5 adds the task router, Batch 8 the research router, Batch 9 the tab
 * manager: each lives in its own module and only message plumbing stays here.
 */

chrome.runtime.onInstalled.addListener((details) => {
  // Toolbar click opens the side panel instead of a popup that closes on click.
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[navigator] sidePanel setup failed', error))

  // An update wipes every alarm, so the recipe library re-arms its own clock.
  void restoreSchedules().catch((error: unknown) => console.warn('[navigator] schedule restore failed', error))

  console.info(`[navigator] ${details.reason} — service worker ready`)
})

// MV3 workers are killed when idle, so re-assert the behaviour on every startup.
chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[navigator] sidePanel setup failed', error))

  void restoreSchedules().catch((error: unknown) => console.warn('[navigator] schedule restore failed', error))
})

// The tab manager's last-seen clock: registrations happen once per worker boot.
startTabWatchers()

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
      ...(message.review !== undefined ? { review: message.review } : {}),
    }
  }
  if (message.kind === 'get-form-fields-active-tab') return { kind: 'get-form-fields' }
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

/** Recipe answers: accepted true/false, and never a rejected message channel. */
async function attempt(run: Promise<unknown>): Promise<BackgroundResponse> {
  try {
    const result = await run
    if (typeof result === 'object' && result !== null && 'ok' in result) {
      return control(() => result as TaskControl)
    }
    return { ok: true, accepted: true }
  } catch (error) {
    return control(() => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  }
}

function handleControlMessage(message: BackgroundMessage): BackgroundResponse | null {
  switch (message.kind) {
    case 'stop-task':
      return control(stopRun)
    case 'approve-action':
      return control(() => resolveApproval(message.id, message.approved))
    case 'answer-question':
      return control(() => resolveQuestion(message.id, message.answer))
    case 'stop-research':
      return control(stopResearch)
    default:
      return null
  }
}

/**
 * `get-article` is answered by `researchHost` directly and `locate` only by the
 * recipe replay host, so neither is ever forwarded from a side-panel message.
 */
type ForwardedResponse = Exclude<
  ContentResponse,
  { ok: true; article: ArticlePayload } | { ok: true; index: number | null }
>

async function forwardToActiveTab(message: BackgroundMessage): Promise<BackgroundResponse> {
  const tabId = await getActiveTabId()

  let response: ForwardedResponse
  try {
    response = (await chrome.tabs.sendMessage(tabId, toContentMessage(message))) as ForwardedResponse
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

  const controlResponse = handleControlMessage(message)
  if (controlResponse !== null) {
    sendResponse(controlResponse)
    return false
  }

  if (message.kind === 'run-research') {
    startResearch(message.question, message.depth)
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

  if (message.kind === 'research-followup') {
    researchFollowup(message.runId, message.question)
      .then((result) => {
        if (result.ok && result.answer !== undefined) {
          sendResponse({ ok: true, answer: result.answer } satisfies BackgroundResponse)
          return
        }
        sendResponse({ ok: false, error: result.error ?? 'The follow-up answer failed.' } satisfies BackgroundResponse)
      })
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, error: text } satisfies BackgroundResponse)
      })
    return true
  }

  if (message.kind === 'tab-command') {
    runTabCommand(message.text)
      .then((report) => sendResponse({ ok: true, report } satisfies BackgroundResponse))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, error: text } satisfies BackgroundResponse)
      })
    return true
  }

  if (message.kind === 'tab-intent') {
    runTabIntent(message.intent)
      .then((report) => sendResponse({ ok: true, report } satisfies BackgroundResponse))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, error: text } satisfies BackgroundResponse)
      })
    return true
  }

  if (message.kind === 'vault') {
    handleVaultRequest(message.request)
      .then((vault) => {
        sendResponse({ ok: true, vault } satisfies BackgroundResponse)
      })
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, error: text } satisfies BackgroundResponse)
      })
    return true
  }

  if (message.kind === 'run-recipe') {
    attempt(startRecipeRun({ id: message.id, values: message.values, mode: message.mode, interactive: true, detached: false })).then(sendResponse)
    return true
  }

  if (message.kind === 'schedule-recipe') {
    attempt(scheduleRecipe(message.id)).then(sendResponse)
    return true
  }

  if (message.kind === 'unschedule-recipe') {
    attempt(unscheduleRecipe(message.id)).then(sendResponse)
    return true
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
