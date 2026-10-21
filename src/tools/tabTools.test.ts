import { describe, expect, it } from 'vitest'

import type { ActResult } from '@/types/actions'
import type { PageState } from '@/types/pageState'
import { fakeMemory, fakeSurface, tab } from '@/tabs/testUtils'
import type { TabIntent, TabReport } from '@/tabs/types'
import { assessRisk } from '@/safety/risk'
import type { ToolContext, ToolHost, ToolSpec } from './types'
import { reportToText, tabTools } from './tabTools'
import { stubNavigation } from './testUtils'

const TABS = [
  tab(1, { index: 0, url: 'https://youtube.com/watch?v=a', title: 'Heat pump mythbusting', active: true }),
  tab(2, { index: 1, url: 'https://youtube.com/watch?v=b', title: 'Battery storage' }),
  tab(3, { index: 2, url: 'https://acme.test/pricing', title: 'Pricing' }),
]

function emptyReport(overrides: Partial<TabReport> = {}): TabReport {
  return {
    ok: true,
    intent: 'list',
    summary: 'done',
    lines: [],
    tabs: TABS,
    found: [],
    stale: [],
    sessions: [],
    closed: 0,
    grouped: 0,
    freedBytes: 0,
    undo: null,
    error: null,
    promptTokens: 0,
    completionTokens: 0,
    ...overrides,
  }
}

/** Records the intents the tools build, and returns a canned report. */
function spy(report: TabReport = emptyReport()): { intents: TabIntent[]; guards: number[][]; context: ToolContext } {
  const intents: TabIntent[] = []
  const guards: number[][] = []
  const host: ToolHost = {
    async pageState(): Promise<PageState> {
      throw new Error('not used by tab tools')
    },
    async formFields() {
      return []
    },
    async act(): Promise<ActResult> {
      return { ok: true, detail: 'noop' }
    },
    async navigate() {},
    async openTab() {
      return 99
    },
    async sleep(ms, signal) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 1), signal))
    },
    review() {},
    locate: async () => null,
    ...stubNavigation(),
  }
  const context: ToolContext = {
    host,
    tabId: 3,
    signal: new AbortController().signal,
    tabs: {
      async run(intent, options) {
        intents.push(intent)
        guards.push(options?.guard?.keepIds ?? [])
        return report
      },
    },
  }
  return { intents, guards, context }
}

function tool(name: string): ToolSpec {
  const found = tabTools().find((spec) => spec.name === name)
  if (found === undefined) throw new Error(`No tool named ${name}`)
  return found
}

async function call(name: string, args: Record<string, unknown>, context: ToolContext) {
  const parsed = tool(name).schema.safeParse(args)
  expect(parsed.success, JSON.stringify(parsed.error?.issues ?? {})).toBe(true)
  if (!parsed.success) return undefined
  const result = await tool(name).run(parsed.data, context)
  return { result, args: parsed.data }
}

describe('tab tools: registration', () => {
  it('exposes twelve tools with unique names', () => {
    const names = tabTools().map((spec) => spec.name)
    expect(names).toHaveLength(12)
    expect(new Set(names).size).toBe(12)
  })

  it('marks the read-only ones safe and the destructive ones high risk', () => {
    const level = (name: string, kind: string) => assessRisk({ tool: name, kind }).level
    expect(level('list_tabs', 'read')).toBe('safe')
    expect(level('search_tabs', 'read')).toBe('safe')
    expect(level('close_tabs', 'write')).toBe('high')
    expect(level('close_duplicate_tabs', 'write')).toBe('high')
    expect(level('suspend_heavy_tabs', 'write')).toBe('medium')
  })

  it('scores every tool it registers', () => {
    for (const spec of tabTools()) {
      expect(assessRisk({ tool: spec.name, kind: spec.kind }).level).not.toBeUndefined()
    }
  })

  it('describes the undo window to the model', () => {
    expect(tool('close_tabs').description).toContain('undo')
    expect(tool('undo_tab_close').description).toContain('60')
  })
})

describe('tab tools: arguments become intents', () => {
  it('scopes a close by host', async () => {
    const { intents, guards, context } = spy()
    await call('close_tabs', { host: 'YouTube.com' }, context)
    expect(intents[0]).toEqual({ kind: 'close', match: { scope: 'host', host: 'youtube.com' } })
    expect(guards[0]).toEqual([3])
  })

  it('prefers a query over a scope and a scope over everything', async () => {
    const { intents, context } = spy()
    await call('close_tabs', { query: 'invoices', scope: 'others' }, context)
    expect(intents[0]).toEqual({ kind: 'close', match: { scope: 'query', query: 'invoices' } })
    await call('group_tabs', { scope: 'others' }, context)
    expect(intents[1]).toEqual({ kind: 'group', match: { scope: 'others' } })
    await call('group_tabs', {}, context)
    expect(intents[2]).toEqual({ kind: 'group', match: { scope: 'all' } })
  })

  it('forwards a tab budget, a session name and a restore name', async () => {
    const { intents, context } = spy()
    await call('suspend_heavy_tabs', { max_tabs: 5 }, context)
    expect(intents[0]).toEqual({ kind: 'free', match: { scope: 'all' }, maxTabs: 5 })
    await call('save_session', { name: 'Kitchen quote', note: 'three bids', tags: ['heat'] }, context)
    expect(intents[1]).toEqual({ kind: 'save', name: 'Kitchen quote', note: 'three bids', tags: ['heat'] })
    await call('restore_session', {}, context)
    expect(intents[2]).toEqual({ kind: 'restore', name: '' })
  })

  it('runs the verbs that need no arguments', async () => {
    const { intents, context } = spy()
    for (const [name, intent] of [
      ['list_tabs', { kind: 'list' }],
      ['close_duplicate_tabs', { kind: 'merge' }],
      ['index_open_pages', { kind: 'index' }],
      ['list_stale_tabs', { kind: 'stale' }],
      ['undo_tab_close', { kind: 'undo' }],
    ] as const) {
      await call(name, {}, context)
    }
    expect(intents.map((entry) => entry.kind)).toEqual(['list', 'merge', 'index', 'stale', 'undo'])
  })

  it('rejects an empty query and an out-of-range budget', () => {
    expect(tool('search_tabs').schema.safeParse({ query: '' }).success).toBe(false)
    expect(tool('suspend_heavy_tabs').schema.safeParse({ max_tabs: 99 }).success).toBe(false)
    expect(tool('save_session').schema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('tab tools: results for the model', () => {
  it('lists every tab with its state', async () => {
    const context = spy().context
    context.tabs = {
      async run() {
        return emptyReport({ tabs: [...TABS, tab(4, { index: 3, url: 'chrome://newtab', pinned: true, groupId: 7 })] })
      },
    }
    const result = await call('list_tabs', {}, context)
    expect(result?.result.content).toContain('[1] Heat pump mythbusting — https://youtube.com/watch?v=a (active)')
    expect(result?.result.content).toContain('[4]')
    expect(result?.result.content).toContain('(pinned)')
    expect(result?.result.content).toContain('(group 7)')
    expect(result?.result.ok).toBe(true)
  })

  it('hands the report text back, including the undo hint', async () => {
    const { context } = spy(
      emptyReport({
        intent: 'close',
        summary: 'Close youtube.com tabs — 2 closed',
        lines: [{ kind: 'close', text: 'closed Battery storage (youtube.com)' }],
        closed: 2,
        undo: { tabs: 2, expiresAt: 1000 },
      }),
    )
    const result = await call('close_tabs', { host: 'youtube.com' }, context)
    expect(result?.result.content).toContain('closed Battery storage')
    expect(result?.result.content).toContain('UNDO is available for 2 closed tab(s) for 60s')
    expect(result?.result.content).not.toContain('Nothing was changed')
  })

  it('says when a bulk operation changed nothing', async () => {
    const { context } = spy(emptyReport({ summary: 'Merge duplicate tabs — no changes' }))
    const result = await call('close_duplicate_tabs', {}, context)
    expect(result?.result.content.startsWith('Merge duplicate tabs — no changes Nothing was changed.')).toBe(true)
  })

  it('prints matches, staleness and sessions as separate sections', () => {
    const text = reportToText(
      emptyReport({
        found: [{ tab: TABS[0]!, score: 0.8, where: 'content', snippet: 'the tariff decides payback' }],
        stale: [{ tab: TABS[2]!, lastSeenAt: 0, daysIdle: 30 }],
        sessions: [{ id: 's1', createdAt: 0, name: 'Kitchen', note: '', tags: ['YouTube'], tabs: [] }],
      }),
    )
    expect(text).toContain('Matches:')
    expect(text).toContain('[tab 1] Heat pump mythbusting (youtube.com) · content · the tariff decides payback')
    expect(text).toContain('Untouched:')
    expect(text).toContain('[tab 3] Pricing · 30 day(s) idle')
    expect(text).toContain('Sessions:')
    expect(text).toContain('"Kitchen" · 0 tab(s) · YouTube')
  })

  it('reports honestly when the manager is not wired in', async () => {
    const host = {
      pageState: async () => {
        throw new Error('unused')
      },
      formFields: async () => [],
      act: async (): Promise<ActResult> => ({ ok: true, detail: 'noop' }),
      navigate: async () => {},
      openTab: async () => 1,
      sleep: async () => {},
      review: () => {},
      locate: async () => null,
      ...stubNavigation(),
    } satisfies ToolHost
    const context: ToolContext = { host, tabId: 1, signal: new AbortController().signal }
    for (const spec of tabTools()) {
      const parsed = spec.schema.safeParse({})
      if (!parsed.success) continue
      const result = await spec.run(parsed.data, context)
      expect(result.ok).toBe(false)
      expect(result.content).toContain('tab manager is not available')
    }
  })
})
