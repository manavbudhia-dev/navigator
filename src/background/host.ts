import { cdpAct } from './cdp'
import { captureScreenshot } from './capture'

import type { ActRequest, ActResult } from '@/types/actions'
import type { PageState } from '@/types/pageState'
import type { SaveFileRequest, SaveFileResult, ToolHost } from '@/tools/types'
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

/**
 * Waits for the tab to enter `status`, or gives up after `timeoutMs`. A tab
 * that is already in that state answers immediately, so the caller does not
 * have to race the event it is about to cause.
 */
function waitForStatus(tabId: number, status: `${chrome.tabs.TabStatus}`, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs)
    function finish(value: boolean): void {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdate)
      resolve(value)
    }
    function onUpdate(id: number, changeInfo: chrome.tabs.OnUpdatedInfo): void {
      if (id === tabId && changeInfo.status === status) finish(true)
    }
    chrome.tabs.onUpdated.addListener(onUpdate)
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === status) finish(true)
      })
      .catch(() => undefined)
  })
}

/**
 * Run `start` and wait for the load it causes. Polling tab.status alone is not
 * enough: Chrome has not marked the tab loading yet when the call returns, so
 * the old page still reads "complete" and the agent describes the page it left
 * as the one it arrived at. Seeing the loading transition first is what makes
 * the wait mean the new document.
 */
async function startAndWait(tabId: number, start: () => Promise<unknown>, timeoutMs = 15_000): Promise<void> {
  const pending = waitForStatus(tabId, 'loading', 1_000)
  await start()
  // A same-document navigation (a fragment link, history.replaceState) never
  // goes through "loading" and is already where the agent wanted to be.
  await pending
  await waitForTabComplete(tabId, timeoutMs)
}

/**
 * A download id until Chrome says it finished, gave up, or went quiet.
 * Resolving with the item is the only way the tool can tell the user where the
 * file actually landed.
 */
function waitForDownload(id: number, timeoutMs = 30_000): Promise<chrome.downloads.DownloadItem | 'interrupted' | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs)
    function finish(result: chrome.downloads.DownloadItem | 'interrupted' | null): void {
      clearTimeout(timer)
      chrome.downloads.onChanged.removeListener(onChange)
      resolve(result)
    }
    function onChange(delta: chrome.downloads.DownloadDelta): void {
      if (delta.id !== id) return
      const state = delta.state?.current
      if (state === 'interrupted') finish('interrupted')
      else if (state === 'complete') void chrome.downloads.search({ id }).then((items) => finish(items[0] ?? null))
    }
    chrome.downloads.onChanged.addListener(onChange)
  })
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
      await startAndWait(tabId, () => chrome.tabs.update(tabId, { url }))
    },

    async openTab(url) {
      const tab = await chrome.tabs.create({ url, active: false })
      if (tab.id === undefined) throw new Error('Chrome refused to open a new tab.')
      return tab.id
    },

    async goBack(tabId) {
      await startAndWait(tabId, () => chrome.tabs.goBack(tabId))
    },

    async goForward(tabId) {
      await startAndWait(tabId, () => chrome.tabs.goForward(tabId))
    },

    async reload(tabId) {
      await startAndWait(tabId, () => chrome.tabs.reload(tabId))
    },

    async waitFor(tabId, condition, value, timeoutMs) {
      return (await sendToTab(tabId, { kind: 'wait-for', condition, value, timeoutMs })) as ActResult
    },

    waitForLoad(tabId, timeoutMs) {
      return waitForTabComplete(tabId, timeoutMs)
    },

    capture(tabId) {
      return captureScreenshot(tabId)
    },

    async saveFile(request): Promise<SaveFileResult> {
      const source =
        request.kind === 'text'
          ? URL.createObjectURL(new Blob([request.text], { type: 'text/plain;charset=utf-8' }))
          : request.url
      try {
        const id = await chrome.downloads.download({
          url: source,
          ...(request.fileName === null ? {} : { filename: request.fileName }),
          saveAs: false,
          conflictAction: 'uniquify',
        })
        if (request.kind === 'text') {
          // The download needs the blob alive until Chrome has taken it.
          setTimeout(() => URL.revokeObjectURL(source), 60_000)
        }
        const item = await waitForDownload(id)
        if (item === 'interrupted') {
          return { ok: false, error: `Chrome interrupted the download of ${request.fileName ?? 'that file'}.` }
        }
        return { ok: true, savedAs: item?.filename ?? request.fileName ?? 'the download' }
      } catch (error) {
        if (request.kind === 'text') URL.revokeObjectURL(source)
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
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
