import { describe, expect, it, vi } from 'vitest'

import type { CompletionResult } from '@/llm/types'
import { TabManager } from './manager'
import { urlKeyOf } from './model'
import { fakeMemory, fakeSurface, indexMap, statsMap, tab, type FakeMemory, type FakeSurface } from './testUtils'
import { UndoBuffer } from './undo'
import type { TabComplete, TabInfo, TabReport } from './types'

const NOW = Date.UTC(2026, 9, 20, 12)
const DAY = 24 * 60 * 60 * 1000

interface Harness {
  surface: FakeSurface
  memory: FakeMemory
  log: string[]
  run(text: string, guard?: number[]): Promise<TabReport>
  manager: TabManager
}

function harness(options: {
  tabs: TabInfo[]
  memory?: FakeMemory
  pages?: Map<number, { url: string; title: string; text: string }>
  complete?: TabComplete
  failRemove?: number[]
}): Harness {
  const log: string[] = []
  const surface = fakeSurface({
    tabs: options.tabs,
    log,
    ...(options.pages === undefined ? {} : { pages: options.pages }),
    ...(options.failRemove === undefined ? {} : { failRemove: options.failRemove }),
  })
  const memory = options.memory ?? fakeMemory()
  const manager = new TabManager({
    surface,
    memory,
    undo: new UndoBuffer(60_000, () => NOW),
    ...(options.complete === undefined ? {} : { complete: options.complete }),
    now: () => NOW,
    newId: () => 's1',
  })
  return {
    surface,
    memory,
    log,
    manager,
    run: (text, guard) => manager.runCommand(text, guard === undefined ? {} : { guard: { keepIds: guard } }),
  }
}

function answer(content: string): CompletionResult {
  return { message: { role: 'assistant', content }, usage: { promptTokens: 40, completionTokens: 6 }, finishReason: 'stop' }
}

function lineText(report: TabReport, kind: string): string {
  return report.lines
    .filter((line) => line.kind === kind)
    .map((line) => line.text)
    .join('\n')
}

const YOU_TUBE = [
  tab(1, { index: 0, url: 'https://youtube.com/watch?v=a', title: 'Heat pump mythbusting' }),
  tab(2, { index: 1, url: 'https://youtube.com/watch?v=b', title: 'Underfloor heating walkthrough' }),
  tab(3, { index: 2, url: 'https://youtube.com/watch?v=c', title: 'Battery storage explained' }),
]

describe('TabManager: listing and closing', () => {
  it('counts tabs per window for a list command', async () => {
    const h = harness({ tabs: YOU_TUBE })
    const report = await h.run('list my open tabs')
    expect(report.ok).toBe(true)
    expect(lineText(report, 'note')).toContain('3 open tab(s) across 1 window(s)')
  })

  it('closes a site’s tabs and records an undo snapshot', async () => {
    const h = harness({ tabs: [...YOU_TUBE, tab(9, { index: 3, url: 'https://arxiv.org/abs/1', title: 'Paper' })] })
    const report = await h.run('close all YouTube tabs')
    expect(report.closed).toBe(3)
    expect(h.log).toContain('remove 1')
    expect(h.surface.snapshot()).toHaveLength(1)
    expect(report.undo).toEqual({ tabs: 3, expiresAt: NOW + 60_000 })
    expect(report.summary).toContain('3 closed')
  })

  it('keeps the active tab, a pinned tab and the agent’s own tab', async () => {
    const tabs = [
      tab(1, { index: 0, url: 'https://youtube.com/a', active: true }),
      tab(2, { index: 1, url: 'https://youtube.com/b', pinned: true }),
      tab(3, { index: 2, url: 'https://youtube.com/c' }),
      tab(4, { index: 3, url: 'https://youtube.com/d' }),
    ]
    const h = harness({ tabs })
    const report = await h.manager.run(
      { kind: 'close', match: { scope: 'all' } },
      { guard: { keepIds: [4] } },
    )
    expect(report.closed).toBe(1)
    expect(h.surface.snapshot().map((tab) => tab.id)).toEqual([1, 2, 4])
    expect(lineText(report, 'skip')).toContain('kept pinned tab')
    expect(lineText(report, 'skip')).toContain('kept the active tab')
    expect(lineText(report, 'skip')).toContain('Navigator is working in')
  })

  it('refuses to close the last tab of a window', async () => {
    const h = harness({
      tabs: [
        tab(1, { index: 0, url: 'https://a.test/1' }),
        tab(2, { index: 1, url: 'https://a.test/2' }),
        tab(3, { index: 0, windowId: 2, url: 'https://b.test/only' }),
      ],
    })
    const report = await h.manager.run({ kind: 'close', match: { scope: 'all' } })
    expect(report.closed).toBe(2)
    expect(h.surface.snapshot().map((tab) => tab.id)).toEqual([3])
    expect(lineText(report, 'skip')).toContain('closing it would close the window')
  })

  it('surfaces a Chrome refusal instead of pretending it worked', async () => {
    const h = harness({ tabs: YOU_TUBE, failRemove: [2] })
    const report = await h.run('close all youtube tabs')
    expect(report.ok).toBe(false)
    expect(report.error).toContain('Chrome refused to close the tab')
    expect(report.summary).toBe(report.error)
  })

  it('reopens everything the last bulk close took', async () => {
    const h = harness({ tabs: [...YOU_TUBE, tab(9, { index: 3, url: 'https://arxiv.org/abs/1', title: 'Paper' })] })
    await h.run('close all youtube tabs')
    const report = await h.manager.run({ kind: 'undo' })
    expect(h.surface.created).toHaveLength(3)
    expect(lineText(report, 'undo')).toContain('Reopened 3 tabs')
    expect(h.manager.undoState()).toBeNull()
  })

  it('says so when the 60 seconds are gone', async () => {
    const h = harness({ tabs: YOU_TUBE })
    const report = await h.manager.run({ kind: 'undo' })
    expect(lineText(report, 'undo')).toContain('Nothing to undo')
    expect(h.surface.created).toHaveLength(0)
  })

  it('never writes last-seen bookkeeping: only real tab use makes a URL fresh', async () => {
    const h = harness({ tabs: YOU_TUBE })
    await h.run('list my open tabs')
    expect(h.memory.statsMap.size).toBe(0)
  })
})

describe('TabManager: grouping', () => {
  it('clusters one site into a named, coloured group', async () => {
    const h = harness({ tabs: YOU_TUBE })
    const report = await h.manager.run({ kind: 'group', match: { scope: 'all' } })
    expect(report.grouped).toBe(3)
    expect(h.log).toContain('group 1+2+3')
    expect(h.log).toContain('name 100 "YouTube" blue')
    expect(lineText(report, 'group')).toContain('as "YouTube"')
  })

  it('names clusters with the model when it answers', async () => {
    const complete = vi.fn<TabComplete>(async () => answer('{"groups":[{"id":"g1-1","name":"Renewable heat"}]}'))
    const h = harness({ tabs: YOU_TUBE, complete })
    const report = await h.manager.run({ kind: 'group', match: { scope: 'all' } })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(h.log).toContain('name 100 "Renewable heat" blue')
    expect(report.promptTokens).toBe(40)
  })

  it('falls back to the deterministic name when the model talks nonsense', async () => {
    const h = harness({ tabs: YOU_TUBE, complete: async () => answer('I would call them fun videos.') })
    await h.manager.run({ kind: 'group', match: { scope: 'all' } })
    expect(h.log).toContain('name 100 "YouTube" blue')
  })

  it('leaves tabs alone when nothing is similar enough to group', async () => {
    const h = harness({
      tabs: [
        tab(1, { index: 0, url: 'https://bluewhale.shop/one', title: 'Cobalt' }),
        tab(2, { index: 1, url: 'https://greenfern.bar/two', title: 'Verdant' }),
      ],
    })
    const report = await h.manager.run({ kind: 'group', match: { scope: 'all' } })
    expect(report.grouped).toBe(0)
    expect(lineText(report, 'note')).toContain('similar enough')
  })

  it('skips tabs that are already grouped', async () => {
    const h = harness({ tabs: YOU_TUBE.map((entry, i) => ({ ...entry, groupId: i === 0 ? 55 : -1 })) })
    const report = await h.manager.run({ kind: 'group', match: { scope: 'all' } })
    expect(report.grouped).toBe(2)
    expect(h.log).toContain('group 2+3')
  })

  it('ungroups the selection', async () => {
    const h = harness({ tabs: YOU_TUBE.map((entry) => ({ ...entry, groupId: 55 })) })
    const report = await h.manager.run({ kind: 'ungroup', match: { scope: 'host', host: 'youtube.com' } })
    expect(h.log).toContain('ungroup 1+2+3')
    expect(lineText(report, 'ungroup')).toContain('ungrouped 3 tabs')
  })
})

describe('TabManager: duplicates', () => {
  it('keeps the best copy and closes the rest', async () => {
    const h = harness({
      tabs: [
        tab(1, { index: 0, url: 'https://acme.test/pricing' }),
        tab(2, { index: 1, url: 'https://www.acme.test/pricing#plans', active: true, title: 'Pricing' }),
        tab(3, { index: 2, url: 'https://other.test/x' }),
      ],
    })
    const report = await h.run('merge duplicate tabs')
    expect(report.closed).toBe(1)
    expect(h.surface.snapshot().map((tab) => tab.id)).toEqual([2, 3])
    expect(lineText(report, 'merge')).toContain('closed 1 duplicate')
    expect(report.undo?.tabs).toBe(1)
  })

  it('reports a clean window', async () => {
    const h = harness({ tabs: [tab(1, { url: 'https://a.test/1' }), tab(2, { url: 'https://b.test/2' })] })
    const report = await h.run('merge duplicate tabs')
    expect(lineText(report, 'note')).toContain('No duplicate tabs')
  })
})

describe('TabManager: search', () => {
  const tabs = [
    tab(1, { index: 0, url: 'https://acme.test/plans', title: 'Plans and pricing' }),
    tab(2, { index: 1, url: 'https://forum.test/thread/9', title: 'Thread 9' }),
  ]

  it('finds a tab by its title', async () => {
    const h = harness({ tabs })
    const report = await h.run('find the tab with the pricing page')
    expect(report.found.map((result) => result.tab.id)).toEqual([1])
    expect(report.found[0]!.where).toBe('title')
    expect(lineText(report, 'search')).toContain('1 match for "pricing"')
  })

  it('looks inside indexed text', async () => {
    const memory = fakeMemory({
      indexMap: indexMap([
        {
          urlKey: urlKeyOf('https://forum.test/thread/9'),
          url: 'https://forum.test/thread/9',
          title: 'Thread 9',
          text: 'The tariff decides the payback period for a heat pump.',
          chars: 54,
          indexedAt: NOW,
        },
      ]),
    })
    const h = harness({ tabs, memory })
    const report = await h.run('search tabs for payback')
    expect(report.found[0]!.where).toBe('content')
  })

  it('activates the best match', async () => {
    const h = harness({ tabs })
    const report = await h.run('switch to the pricing page')
    expect(h.log).toContain('update 1 {"active":true}')
    expect(lineText(report, 'switch')).toContain('switched to Plans and pricing')
  })

  it('admits when nothing matched', async () => {
    const h = harness({ tabs })
    const report = await h.run('find the sourdough tab')
    expect(report.found).toEqual([])
    expect(lineText(report, 'search')).toContain('Nothing matched')
  })
})

describe('TabManager: memory and staleness', () => {
  it('suspends the heaviest inactive tabs and reports an estimate', async () => {
    const h = harness({
      tabs: [
        tab(1, { index: 0, url: 'https://a.test/one', active: true }),
        tab(2, { index: 1, url: 'https://a.test/two', title: 'Two' }),
        tab(3, { index: 2, url: 'https://a.test/three', title: 'Three' }),
      ],
      memory: fakeMemory({
        indexMap: indexMap([
          {
            urlKey: urlKeyOf('https://a.test/two'),
            url: 'https://a.test/two',
            title: 'Two',
            text: 'y'.repeat(100_000),
            chars: 100_000,
            indexedAt: NOW,
          },
        ]),
      }),
    })
    const report = await h.manager.run({ kind: 'free', match: { scope: 'all' } })
    expect(h.log).toContain('update 2 {"discarded":true}')
    expect(h.log).toContain('update 3 {"discarded":true}')
    expect(report.freedBytes).toBeGreaterThan(0)
    expect(lineText(report, 'note')).toContain('(estimate)')
    expect(report.summary).toContain('MB freed')
  })

  it('has nothing to suspend when every tab is busy', async () => {
    const h = harness({ tabs: [tab(1, { active: true }), tab(2, { pinned: true })] })
    const report = await h.manager.run({ kind: 'free', match: { scope: 'all' } })
    expect(report.freedBytes).toBe(0)
    expect(lineText(report, 'note')).toContain('No inactive tab')
  })

  it('suggests archiving stale tabs without closing them', async () => {
    const tabs = [
      tab(1, { index: 0, url: 'https://a.test/old', title: 'Old' }),
      tab(2, { index: 1, url: 'https://a.test/fresh', title: 'Fresh' }),
    ]
    const memory = fakeMemory({
      statsMap: statsMap([
        { urlKey: urlKeyOf('https://a.test/old'), title: 'Old', lastSeenAt: NOW - 20 * DAY, opens: 1 },
        { urlKey: urlKeyOf('https://a.test/fresh'), title: 'Fresh', lastSeenAt: NOW - DAY, opens: 3 },
      ]),
    })
    const h = harness({ tabs, memory })
    const report = await h.manager.run({ kind: 'stale', days: 7 })
    expect(report.stale.map((entry) => entry.tab.id)).toEqual([1])
    expect(report.closed).toBe(0)
    expect(h.log.filter((entry) => entry.startsWith('remove'))).toEqual([])
    expect(lineText(report, 'note')).toContain('Save them as a session')
  })

  it('says when nothing is stale', async () => {
    const h = harness({ tabs: [tab(1, { url: 'https://a.test/x' })] })
    const report = await h.manager.run({ kind: 'stale', days: 7 })
    expect(lineText(report, 'stale')).toContain('Nothing untouched for 7+ days')
  })
})

describe('TabManager: index and sessions', () => {
  const pages = new Map([
    [1, { url: 'https://a.test/one', title: 'One', text: 'x'.repeat(500) }],
    [2, { url: 'https://a.test/two', title: 'Two', text: 'too short' }],
  ])

  it('indexes readable pages and skips thin ones', async () => {
    const h = harness({ tabs: [tab(1, { index: 0, url: 'https://a.test/one' }), tab(2, { index: 1, url: 'https://a.test/two' })], pages })
    const report = await h.manager.run({ kind: 'index' })
    expect(h.memory.indexMap.size).toBe(1)
    expect(h.memory.indexMap.get(urlKeyOf('https://a.test/one'))!.chars).toBe(500)
    expect(lineText(report, 'index')).toContain('Indexed 1 page(s), skipped 1 without readable text')
    expect(report.ok).toBe(true)
  })

  it('caps a pass so a huge window cannot hang the panel', async () => {
    const tabs = Array.from({ length: 6 }, (_, i) => tab(i + 1, { index: i, url: `https://a.test/${i}` }))
    const h = harness({ tabs, pages })
    const manager = new TabManager({
      surface: h.surface,
      memory: h.memory,
      indexLimit: 2,
      now: () => NOW,
    })
    await manager.run({ kind: 'index' })
    expect(h.log.filter((entry) => entry.startsWith('read'))).toHaveLength(2)
  })

  it('saves a session with default tags from the busiest hosts', async () => {
    const h = harness({ tabs: [...YOU_TUBE, tab(9, { index: 3, url: 'https://arxiv.org/abs/1', title: 'Paper' })] })
    const report = await h.manager.run({ kind: 'save', name: 'Kitchen quote', note: 'get three bids', tags: [] })
    const [session] = h.memory.saved
    expect(session!.name).toBe('Kitchen quote')
    expect(session!.tags).toEqual(['YouTube', 'Arxiv'])
    expect(session!.tabs).toHaveLength(4)
    expect(lineText(report, 'session')).toContain('Saved 4 tab(s) as "Kitchen quote"')
  })

  it('never repeats a tag that two different sites both label the same', async () => {
    const h = harness({
      tabs: [
        tab(1, { url: 'https://blog.example.com/a', title: 'A' }),
        tab(2, { url: 'https://metering.example.edu/b', title: 'B' }),
        tab(3, { url: 'https://watch.example.org/c', title: 'C' }),
        tab(4, { url: 'https://youtube.com/watch?v=a', title: 'D' }),
      ],
    })
    await h.manager.run({ kind: 'save', name: '', note: '', tags: [] })
    expect(h.memory.saved[0]!.tags).toEqual(['Example', 'YouTube'])
  })

  it('names an unnamed session after the day', async () => {
    const h = harness({ tabs: YOU_TUBE })
    await h.manager.run({ kind: 'save', name: '', note: '', tags: [] })
    expect(h.memory.saved[0]!.name.startsWith('Session')).toBe(true)
  })

  it('lists saved sessions newest first', async () => {
    const h = harness({
      tabs: YOU_TUBE,
      memory: fakeMemory({
        saved: [
          { id: 'a', createdAt: NOW - DAY, name: 'Older', note: '', tags: [], tabs: [] },
          { id: 'b', createdAt: NOW, name: 'Newer', note: '', tags: [], tabs: [] },
        ],
      }),
    })
    const report = await h.run('show me my saved sessions')
    expect(report.sessions.map((session) => session.name)).toEqual(['Newer', 'Older'])
    expect(lineText(report, 'session')).toContain('2 saved sessions')
  })

  it('reopens a session but not URLs already open', async () => {
    const memory = fakeMemory({
      saved: [
        {
          id: 'a',
          createdAt: NOW,
          name: 'Kitchen quote',
          note: '',
          tags: [],
          tabs: [
            { url: 'https://youtube.com/watch?v=a', title: 'A', windowId: 1, index: 0 },
            { url: 'https://supplier.test/quote', title: 'B', windowId: 1, index: 1 },
          ],
        },
      ],
    })
    const h = harness({ tabs: [tab(1, { index: 0, url: 'https://youtube.com/watch?v=a' })], memory })
    const report = await h.run('restore the Kitchen quote session')
    expect(h.surface.created).toHaveLength(1)
    expect(lineText(report, 'restore')).toContain('1 tab(s) opened, 1 already open')
  })

  it('says which session it meant when the name is unknown', async () => {
    const h = harness({ tabs: YOU_TUBE, memory: fakeMemory({ saved: [{ id: 'a', createdAt: NOW, name: 'Garden', note: '', tags: [], tabs: [] }] }) })
    const report = await h.run('restore the missing session')
    expect(lineText(report, 'session')).toContain('Known: Garden')
  })

  it('has nothing to restore before the first save', async () => {
    const h = harness({ tabs: YOU_TUBE })
    const report = await h.run('restore the session')
    expect(lineText(report, 'session')).toContain('No saved sessions yet')
  })
})

describe('TabManager: commands the rules cannot read', () => {
  it('asks the model, then runs what it understood', async () => {
    const complete = vi.fn<TabComplete>(async () => answer('{"intent":"group","scope":"all"}'))
    const h = harness({ tabs: YOU_TUBE, complete })
    const report = await h.run('sort out my browsing mess')
    // Once to classify the sentence, once to name the clusters it asked for.
    expect(complete).toHaveBeenCalledTimes(2)
    expect(report.intent).toBe('group')
    expect(report.grouped).toBe(3)
  })

  it('explains what it can do when even the model draws a blank', async () => {
    const h = harness({ tabs: YOU_TUBE, complete: async () => answer('{"intent":"fly_to_the_moon"}') })
    const report = await h.run('sort out my browsing mess')
    expect(report.ok).toBe(false)
    expect(report.summary).toContain('could not tell what to do')
  })

  it('does not call the model for a sentence the rules already read', async () => {
    const complete = vi.fn<TabComplete>(async () => answer('{}'))
    const h = harness({ tabs: YOU_TUBE, complete })
    await h.run('close all youtube tabs')
    expect(complete).not.toHaveBeenCalled()
  })
})
