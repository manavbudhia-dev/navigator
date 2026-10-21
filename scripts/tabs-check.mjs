import { existsSync } from 'node:fs'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const BASE = 'http://localhost:5173'

/** Real fixture pages, so the index pass reads actual page text. */
const PAGES = {
  'https://metering.example.edu/heat-pump-bill-savings': '/fixtures/research-metering.html',
  'https://heatpumpwatch.example.org/cold-climate-failures': '/fixtures/research-coldclimate.html',
  'https://blog.example.com/sourdough-bread-guide': '/fixtures/research-bread.html',
}

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
page.on('pageerror', (error) => console.error('[pageerror]', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.error('[console]', message.text())
})
await page.goto(`${BASE}/src/sidepanel/index.html`, { waitUntil: 'networkidle0' })

const report = await page.evaluate(async (pages) => {
  const { TabManager } = await import('/src/tabs/manager.ts')
  const { UndoBuffer } = await import('/src/tabs/undo.ts')
  const { fakeSurface, tab } = await import('/src/tabs/testUtils.ts')
  const { urlKeyOf } = await import('/src/tabs/model.ts')
  const { tabMemory } = await import('/src/tabs/store.ts')
  const { parseCommand } = await import('/src/tabs/commands.ts')
  const { db } = await import('/src/memory/db.ts')

  await db.tabStats.clear()
  await db.tabIndex.clear()
  await db.sessions.clear()

  const NOW = Date.now()
  const DAY = 86_400_000

  // A messy window: two heat-pump pages that belong together, three YouTube
  // tabs, a duplicate of the metering page, a sourdough page nobody has read
  // since September, and a pinned tab that must never be touched.
  const START = [
    tab(1, {
      url: 'https://metering.example.edu/heat-pump-bill-savings',
      title: 'Heat pump bill savings study',
      active: true,
    }),
    tab(2, {
      url: 'https://heatpumpwatch.example.org/cold-climate-failures',
      title: 'Cold climate heat pump failures',
    }),
    tab(3, { url: 'https://youtube.com/watch?v=a', title: 'Heat pump mythbusting' }),
    tab(4, { url: 'https://youtube.com/watch?v=b', title: 'Sourdough starter tour' }),
    tab(5, { url: 'https://music.youtube.com/listen', title: 'Focus playlist' }),
    tab(6, {
      url: 'https://www.metering.example.edu/heat-pump-bill-savings?utm_source=x#top',
      title: 'Heat pump bill savings study',
    }),
    tab(7, { url: 'https://blog.example.com/sourdough-bread-guide', title: 'Sourdough bread guide' }),
    tab(8, { url: 'https://work.example.com/invoice-412', title: 'Invoice 412', pinned: true }),
    tab(9, { url: 'chrome://newtab', title: 'New tab' }),
  ]

  const log = []
  const surface = fakeSurface({ tabs: START, log })

  // readPage returns fixture text for the pages we have, nothing elsewhere.
  const parse = async (path) => {
    const response = await fetch(path)
    if (!response.ok) return null
    return new DOMParser().parseFromString(await response.text(), 'text/html')
  }
  const texts = new Map()
  for (const [url, path] of Object.entries(pages)) {
    const doc = await parse(path)
    if (doc !== null) texts.set(urlKeyOf(url), (doc.querySelector('main') ?? doc.body).textContent ?? '')
  }
  const inner = surface.readPage.bind(surface)
  surface.readPage = async (tabId) => {
    const found = START.find((entry) => entry.id === tabId)
    const text = found === undefined ? undefined : texts.get(urlKeyOf(found.url))
    if (text === undefined || text.trim().length < 200) return inner(tabId)
    return { url: found.url, title: found.title, text: text.trim() }
  }

  // Only the stale sweeper needs the last-seen clock; run() must not write it.
  const SEED_STATS = [
    { urlKey: urlKeyOf('https://blog.example.com/sourdough-bread-guide'), title: 'Sourdough bread guide', lastSeenAt: NOW - 40 * DAY, opens: 2 },
    { urlKey: urlKeyOf('https://metering.example.edu/heat-pump-bill-savings'), title: 'Heat pump study', lastSeenAt: NOW - 1 * DAY, opens: 5 },
  ]
  await db.tabStats.bulkPut(SEED_STATS)
  // The real Dexie-backed memory: index rows and sessions must land in IndexedDB.
  const memory = tabMemory

  const make = (undo, now = () => NOW) =>
    new TabManager({
      surface,
      memory,
      undo,
      now,
      newId: () => `session-${Math.random().toString(36).slice(2, 7)}`,
      indexLimit: 8,
    })

  const out = { runs: [], log: {}, counts: {} }

  // 1. The four spec sentences must map to the four spec verbs.
  const OPEN = await surface.list()
  out.parse = {
    close: parseCommand('close all YouTube tabs', OPEN),
    group: parseCommand('group my work tabs', OPEN),
    find: parseCommand('find the tab with the pricing page', OPEN),
    save: parseCommand('save this session for tomorrow', OPEN),
    nonsense: parseCommand('sort out my browsing mess', OPEN),
  }

  // 2. Index, then search inside a page that is open but never read here.
  {
    const undo = new UndoBuffer(60_000, () => NOW)
    const manager = make(undo)
    const indexed = await manager.run({ kind: 'index' })
    const search = await manager.run({ kind: 'find', query: 'coefficient of performance' })
    out.index = {
      ok: indexed.ok,
      lines: indexed.lines.length,
      rows: await db.tabIndex.count(),
      found: search.found.length,
      where: search.found.map((hit) => `${hit.tab.id}:${hit.where}`),
      snippet: (search.found[0]?.snippet ?? '').slice(0, 40),
    }
  }

  // 3. Auto-grouping: cluster, name, colour.
  {
    const undo = new UndoBuffer(60_000, () => NOW)
    const manager = make(undo)
    const grouped = await manager.run({ kind: 'group', match: { scope: 'all' } })
    out.group = {
      ok: grouped.ok,
      grouped: grouped.grouped,
      summary: grouped.summary,
      lines: grouped.lines.map((line) => line.text),
      log: log.filter((entry) => entry.startsWith('group') || entry.startsWith('name')),
      stillUngrouped: (await surface.list()).filter((entry) => entry.groupId < 0).length,
    }
  }

  // 4. Duplicate merge on canonical URL, never a pinned tab.
  {
    const before = log.length
    const manager = make(new UndoBuffer(60_000, () => NOW))
    const merged = await manager.run({ kind: 'merge', match: { scope: 'all' } })
    out.merge = {
      ok: merged.ok,
      closed: merged.closed,
      summary: merged.summary,
      removed: log.slice(before).filter((entry) => entry.startsWith('remove')),
      pinnedAlive: (await surface.list()).some((entry) => entry.id === 8),
    }
  }

  // 5. Stale sweeper proposes, never closes.
  {
    const before = log.length
    const manager = make(new UndoBuffer(60_000, () => NOW))
    const stale = await manager.run({ kind: 'stale', days: 7 })
    out.stale = {
      ok: stale.ok,
      reported: stale.stale.length,
      daysIdle: stale.stale.map((entry) => entry.daysIdle),
      closed: log.slice(before).filter((entry) => entry.startsWith('remove')).length,
    }
  }

  // 6. Memory saver: suspends heavy inactive tabs and reports bytes.
  {
    const manager = make(new UndoBuffer(60_000, () => NOW))
    const freed = await manager.run({ kind: 'free', match: { scope: 'all' } })
    out.free = {
      ok: freed.ok,
      freedBytes: freed.freedBytes,
      suspended: (await surface.list()).filter((entry) => entry.discarded).length,
      summary: freed.summary,
    }
  }

  // 7. Close by host, then UNDO inside the 60s window.
  {
    let CLOCK = NOW
    const undo = new UndoBuffer(60_000, () => CLOCK)
    const manager = make(undo, () => CLOCK)
    const closed = await manager.runCommand('close all YouTube tabs')
    const undone = await manager.run({ kind: 'undo' })
    out.undo = {
      closed: closed.closed,
      snapshot: closed.undo,
      reopened: undone.ok,
      lines: undone.lines.map((line) => line.text),
      created: (await surface.list()).filter((entry) => entry.url.includes('youtube.com')).length,
    }

    // The same buffer, 61 seconds later: the window must have expired.
    const expiry = new UndoBuffer(60_000, () => CLOCK)
    const scoped = make(expiry, () => CLOCK)
    const closedBefore = (await scoped.runCommand('close all YouTube tabs')).closed
    CLOCK = NOW + 61_000
    const tooLate = await scoped.run({ kind: 'undo' })
    out.undo.closedBefore = closedBefore
    out.undo.expiredRefused = tooLate.lines.some((line) => line.text.includes('Nothing to undo'))
  }

  // 8. Sessions: save against the live window, restore reopens what is missing.
  {
    const undo = new UndoBuffer(60_000, () => NOW)
    const manager = make(undo)
    const saved = await manager.runCommand('save this session for tomorrow')
    const live = await surface.list()
    const gone = live.find((entry) => entry.id === 3)
    await surface.remove(gone === undefined ? [] : [gone.id])
    const restored = await manager.runCommand('restore the session from tomorrow')
    out.sessions = {
      savedName: saved.lines.map((line) => line.text),
      stored: await db.sessions.count(),
      tags: (await db.sessions.toArray())[0]?.tags ?? [],
      restoreLines: restored.lines.map((line) => line.text),
      created: restored.lines.filter((line) => line.kind === 'restore').length,
      listed: (await manager.run({ kind: 'sessions' })).sessions.length,
    }
  }

  // 9. Persistence is the real Dexie store, not the fake memory.
  {
    const saved = await tabMemory.listSessions()
    out.counts = {
      sessions: saved.length,
      stats: await db.tabStats.count(),
      indexRows: await db.tabIndex.count(),
      tabIndexText: (await db.tabIndex.toArray()).some((row) => row.text.length > 200),
    }
  }

  // 10. Refusals: the last tab of a window and a protected page.
  {
    const lonely = fakeSurface({ tabs: [tab(50, { url: 'https://lonely.example/a', title: 'Only one' })], log: [] })
    const manager = new TabManager({ surface: lonely, memory, undo: new UndoBuffer(60_000, () => NOW), now: () => NOW })
    const refused = await manager.run({ kind: 'close', match: { scope: 'all' } })
    const chromePages = await manager.runCommand('close all chrome tabs')
    out.refusals = {
      refusedOk: refused.ok,
      refusedClosed: refused.closed,
      refusedLines: refused.lines.map((line) => line.text),
      chromeOk: chromePages.ok,
      chromeClosed: chromePages.closed,
    }
  }

  out.finalTabs = (await surface.list()).length
  out.logTotals = {
    removes: log.filter((entry) => entry.startsWith('remove')).length,
    groups: log.filter((entry) => entry.startsWith('group')).length,
    names: log.filter((entry) => entry.startsWith('name')).length,
    reads: log.filter((entry) => entry.startsWith('read')).length,
  }
  out.statsAfterRuns = await db.tabStats.count()
  return out
}, PAGES)

await browser.close()

const checks = {
  specSentencesParse:
    report.parse.close?.kind === 'close' &&
    report.parse.group?.kind === 'group' &&
    report.parse.find?.kind === 'find' &&
    report.parse.find?.query === 'pricing' &&
    report.parse.save?.kind === 'save' &&
    report.parse.nonsense === null,
  pagesWereIndexed: report.index.rows >= 2 && report.index.ok,
  contentSearchFindsUnreadTab:
    report.index.found >= 1 && report.index.where.some((entry) => entry.endsWith('content')),
  snippetFromPageText: report.index.snippet.length > 10,
  tabsWereGrouped:
    report.group.grouped >= 2 &&
    report.group.log.some((entry) => entry.startsWith('group')) &&
    report.group.log.some((entry) => /name \d+ ".*" (blue|green|yellow|cyan|purple|pink|orange|grey|red)/.test(entry)),
  duplicatesMerged: report.merge.closed >= 1 && report.merge.pinnedAlive,
  staleOnlyProposed: report.stale.reported === 1 && report.stale.closed === 0 && report.stale.daysIdle[0] >= 7,
  memoryFreedReported: report.free.freedBytes > 0 && report.free.suspended >= 1,
  undoReopensClosedTabs:
    report.undo.closed >= 2 &&
    report.undo.snapshot !== null &&
    report.undo.snapshot.tabs === report.undo.closed &&
    report.undo.created >= 2,
  undoExpires: report.undo.expiredRefused,
  sessionSavedAndRestored:
    report.sessions.stored === 1 &&
    report.sessions.tags.length >= 1 &&
    report.sessions.created >= 1 &&
    report.sessions.listed === 1,
  lastTabOfWindowRefused: report.refusals.refusedClosed === 0 || report.refusals.refusedLines.join(' ').includes('last'),
  chromePagesNotClosed: report.refusals.chromeClosed === 0,
  runsNeverWriteLastSeen: report.statsAfterRuns === 2,
  everythingPersisted: report.counts.sessions === 1 && report.counts.indexRows >= 2 && report.counts.tabIndexText,
}

console.log(JSON.stringify(report, null, 2))
console.log(JSON.stringify(checks, null, 2))

const failed = Object.entries(checks).filter(([, ok]) => ok !== true)
console.log(failed.length === 0 ? 'TABS CHECK: PASS' : `TABS CHECK: FAIL ${failed.map(([k]) => k).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
