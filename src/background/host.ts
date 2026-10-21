import { cdpAct } from './cdp'

import type { ActRequest, ActResult } from '@/types/actions'
import type { PageState } from '@/types/pageState'
import type { ToolHost } from '@/tools/types'
import type { ContentMessage, ContentResponse } from '@/types/messages'

/**
 * ToolHost implementation for the service worker: the bridge between the
 * tool registry and Chrome. Content-script events first; when the content
 * script reports it could not finish (fellBack), the trusted CDP path takes
 * over.
 */

async function sendToTab(tabId: number, message: ContentMessage): Promise<ContentResponse> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as ContentResponse
  } catch {
    throw new Error('Content script is not running on this tab. Reload the page and try again.')
  }
}

/** True when the tab reached "complete"; false when the timeout ran out first. */
export async function waitForTabComplete(tabId: number, timeoutMs = 15_000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

async function runAct(tabId: number, action: ActRequest): Promise<ActResult> {
  const result = (await sendToTab(tabId, { kind: 'act', action })) as ActResult
  if (result.ok && result.fellBack && action.type === 'type') {
    // Contenteditable / rich-text fields: the element is already focused,
    // so trusted key events land in it directly. The control behind the action
    // is still the one the content script reported.
    const detail = await cdpAct(tabId, action, null, action.text, action.submit ?? false)
    return { ok: true, detail, ...(result.target !== undefined ? { target: result.target } : {}) }
  }
  return result
}

export function createToolHost(): ToolHost {
  return {
    async pageState(tabId, includeOffViewport) {
      const message: ContentMessage =
        includeOffViewport === undefined
          ? { kind: 'get-page-state' }
          : { kind: 'get-page-state', includeOffViewport }
      const response = await sendToTab(tabId, message)
      if (!('pageState' in response)) throw new Error('Page state request failed.')
      return response.pageState
    },

    async formFields(tabId) {
      const response = await sendToTab(tabId, { kind: 'get-form-fields' })
      if (!('fields' in response)) throw new Error('Form field request failed.')
      return response.fields
    },

    act: runAct,

    async locate(tabId, target) {
      const response = await sendToTab(tabId, { kind: 'locate', target })
      if (!('index' in response)) throw new Error('Locate request failed.')
      return response.index
    },

    async navigate(tabId, url) {
      await chrome.tabs.update(tabId, { url })
      await waitForTabComplete(tabId)
    },

    async openTab(url) {
      const tab = await chrome.tabs.create({ url, active: false })
      if (tab.id === undefined) throw new Error('Chrome refused to open a new tab.')
      return tab.id
    },

    async goBack(tabId) {
      await chrome.tabs.goBack(tabId)
      await waitForTabComplete(tabId)
    },

    async goForward(tabId) {
      await chrome.tabs.goForward(tabId)
      await waitForTabComplete(tabId)
    },

    async reload(tabId) {
      await chrome.tabs.reload(tabId)
      await waitForTabComplete(tabId)
    },

    async waitFor(tabId, condition, value, timeoutMs) {
      return (await sendToTab(tabId, { kind: 'wait-for', condition, value, timeoutMs })) as ActResult
    },

    waitForLoad(tabId, timeoutMs) {
      return waitForTabComplete(tabId, timeoutMs)
    },

    review(tabId, indices) {
      const message: ContentMessage = { kind: 'overlay', review: indices }
      void sendToTab(tabId, message).catch(() => undefined)
    },

    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        function onAbort(): void {
          clearTimeout(timer)
          reject(signal.reason)
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
}
