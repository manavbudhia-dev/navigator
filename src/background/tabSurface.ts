import type { ArticlePayload } from '@/research/types'
import type { TabGroupColor, TabInfo, TabPage, TabSurface } from '@/tabs/types'
import type { ContentResponse } from '@/types/messages'

/**
 * TabSurface for the service worker: the only file in the tab manager that
 * talks to Chrome. Everything it returns is normalised so the pure modules
 * never deal with `undefined`.
 */

const GROUP_COLORS: TabGroupColor[] = ['blue', 'red', 'yellow', 'green', 'cyan', 'pink', 'purple', 'orange', 'grey']

export function toTabInfo(tab: chrome.tabs.Tab): TabInfo {
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId,
    index: tab.index,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    active: tab.active === true,
    pinned: tab.pinned === true,
    discarded: tab.discarded === true,
    groupId: typeof tab.groupId === 'number' ? tab.groupId : -1,
  }
}

function asColor(value: string | undefined): TabGroupColor {
  const name = typeof value === 'string' ? value : ''
  return GROUP_COLORS.find((color) => color === name) ?? 'blue'
}

export function createChromeTabSurface(): TabSurface {
  return {
    async list() {
      const tabs = await chrome.tabs.query({})
      return tabs.map(toTabInfo).filter((tab) => tab.id >= 0)
    },

    async groups() {
      const groups = await chrome.tabGroups.query({})
      return groups.map((group) => ({ id: group.id, title: group.title ?? '', color: asColor(group.color) }))
    },

    async update(tabId, changes) {
      await chrome.tabs.update(tabId, changes)
    },

    async create(tab) {
      const created = await chrome.tabs.create({
        url: tab.url,
        active: tab.active,
        ...(tab.windowId === undefined ? {} : { windowId: tab.windowId }),
        ...(tab.index === undefined ? {} : { index: tab.index }),
      })
      if (created.id === undefined) throw new Error('Chrome refused to open a tab.')
      return created.id
    },

    async remove(tabIds) {
      if (tabIds.length === 0) return
      await chrome.tabs.remove(tabIds)
    },

    async group(tabIds) {
      if (tabIds.length === 0) return -1
      const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] })
      return typeof groupId === 'number' ? groupId : -1
    },

    async ungroup(tabIds) {
      if (tabIds.length === 0) return
      await chrome.tabs.ungroup(tabIds as [number, ...number[]])
    },

    async nameGroup(groupId, title, color) {
      if (groupId < 0) return
      await chrome.tabGroups.update(groupId, { title, color })
    },

    async readPage(tabId) {
      let response: ContentResponse
      try {
        response = (await chrome.tabs.sendMessage(tabId, { kind: 'get-article' })) as ContentResponse
      } catch {
        // No content script here (chrome://, the store, a pre-install tab).
        return null
      }
      if (!('article' in response)) return null
      const article: ArticlePayload = response.article
      const page: TabPage = { url: article.url, title: article.title, text: article.text }
      return page
    },
  }
}
