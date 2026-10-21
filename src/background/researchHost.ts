import { rankHits } from '@/research/search'
import type { ContentMessage, ContentResponse } from '@/types/messages'

import type { ArticlePayload, PageArticle, ResearchHost } from '@/research/types'

/**
 * ResearchHost for the service worker (spec §7 GATHER): every page is read in
 * a real background tab so JavaScript-rendered sites work, then closed again.
 * The engine's worker pool already bounds how many tabs exist at once; this
 * file just makes sure none of them leak when a run is stopped.
 */

/** A SERP that is plain HTML and tolerates being scraped from a tab. */
function searchUrl(query: string): string {
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
}

const LOAD_TIMEOUT_MS = 20_000
const POLL_MS = 150

async function sendToTab(tabId: number, message: ContentMessage): Promise<ArticlePayload> {
  const response = (await chrome.tabs.sendMessage(tabId, message)) as ContentResponse
  if (!('article' in response)) throw new Error('The page did not answer the article request.')
  return response.article
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      reject(new Error('Research was stopped.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function waitForLoad(tabId: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return
    await delay(POLL_MS, signal)
  }
}

export interface TabResearchHost extends ResearchHost {
  /** Close every tab this host opened — called when a run ends or stops. */
  dispose(): Promise<void>
}

export function createResearchHost(): TabResearchHost {
  const open = new Set<number>()

  async function openInBackground(url: string, signal: AbortSignal): Promise<number> {
    const tab = await chrome.tabs.create({ url, active: false })
    if (tab.id === undefined) throw new Error('Chrome refused to open a background tab.')
    open.add(tab.id)
    try {
      await waitForLoad(tab.id, signal)
    } catch (error) {
      await close(tab.id)
      throw error
    }
    return tab.id
  }

  async function close(tabId: number): Promise<void> {
    open.delete(tabId)
    await chrome.tabs.remove(tabId).catch(() => undefined)
  }

  return {
    async search(query, limit, signal) {
      const tabId = await openInBackground(searchUrl(query), signal)
      try {
        const article = await sendToTab(tabId, { kind: 'get-article' })
        return rankHits(article.links, query, limit, { baseUrl: article.url })
      } finally {
        await close(tabId)
      }
    },

    async readPage(url, signal): Promise<PageArticle | null> {
      const tabId = await openInBackground(url, signal)
      try {
        const article = await sendToTab(tabId, { kind: 'get-article' })
        const { links: _links, ...page } = article
        return page
      } catch {
        return null
      } finally {
        await close(tabId)
      }
    },

    async dispose() {
      const ids = [...open]
      open.clear()
      await Promise.all(ids.map((id) => chrome.tabs.remove(id).catch(() => undefined)))
    },
  }
}
