import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const BASE = 'http://localhost:5173'
const PANEL = `${BASE}/src/sidepanel/index.html`
const SHOT = (name) => join(tmpdir(), name)

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--force-device-scale-factor=1'],
})

const page = await browser.newPage()
page.on('pageerror', (error) => console.error('[pageerror]', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.error('[console]', message.text())
})
await page.setViewport({ width: 420, height: 1000 })

/**
 * A fake browser: the panel talks to the service worker over
 * `chrome.runtime.sendMessage`, so the harness answers those messages by
 * running the REAL TabManager over a fake tab surface. Nothing else in the
 * panel is faked — parsing, clustering, undo and reporting all execute.
 */
await page.evaluateOnNewDocument(() => {
  const DAY = 86_400_000
  const SEED = [
    { id: 1, url: 'https://youtube.com/watch?v=heatpump', title: 'Heat pump mythbusting' },
    { id: 2, url: 'https://youtube.com/watch?v=bread', title: 'Sourdough starter tour' },
    { id: 3, url: 'https://music.youtube.com/listen', title: 'Focus playlist' },
    { id: 4, url: 'https://arxiv.org/abs/2601.00001', title: 'Retrofit energy models' },
    { id: 5, url: 'https://arxiv.org/abs/2601.00002', title: 'Cold climate heat pumps' },
    { id: 6, url: 'https://acme.example/pricing', title: 'Acme pricing', active: true },
    { id: 7, url: 'https://www.acme.example/pricing?utm_source=ads#plans', title: 'Acme pricing' },
    { id: 8, url: 'https://blog.example.net/notes-on-timber', title: 'Timber frame notes' },
    { id: 9, url: 'https://work.example.com/invoice-412', title: 'Invoice 412', pinned: true },
    { id: 10, url: 'https://docs.example.io/handbook', title: 'Handbook: seats and billing' },
    { id: 11, url: 'chrome://newtab', title: 'New tab' },
  ]

  // Only readable for two tabs: one of them never says "pricing" in its title.
  const BODIES = {
    7:
      'Acme pricing plans compared. The annual plan costs 240 per seat and the monthly plan costs 24 per seat. ' +
      'Enterprise pricing includes SSO, audit logs and a dedicated success manager. Volume discounts start at fifty seats, ' +
      'and the starter tier is capped at three seats with no API access. Nonprofits receive the annual plan at half price.',
    10:
      'Handbook chapter on billing and administration. Seat pricing is quoted per user per month and invoiced annually in advance. ' +
      'The annual plan discounts three months compared with paying monthly. Removing a seat mid term leaves the credit on the account, ' +
      'which applies automatically to the next invoice without contacting sales.',
  }

  const listeners = []
  let built = null

  async function build() {
    if (built !== null) return built
    const { TabManager } = await import('/src/tabs/manager.ts')
    const { UndoBuffer } = await import('/src/tabs/undo.ts')
    const { fakeSurface, tab } = await import('/src/tabs/testUtils.ts')
    const { urlKeyOf } = await import('/src/tabs/model.ts')
    const { tabMemory } = await import('/src/tabs/store.ts')
    const { db } = await import('/src/memory/db.ts')

    const now = () => Date.now()
    // The real Dexie memory, seeded once: saved sessions must still be listed
    // after a reload, exactly as they are for a user in a real panel.
    if (sessionStorage.getItem('navigator-tabs-seeded') === null) {
      await db.tabIndex.clear()
      await db.sessions.clear()
      await db.tabStats.bulkPut([
        { urlKey: urlKeyOf('https://blog.example.net/notes-on-timber'), title: 'Timber frame notes', lastSeenAt: now() - 45 * DAY, opens: 1 },
        { urlKey: urlKeyOf('https://arxiv.org/abs/2601.00001'), title: 'Retrofit energy models', lastSeenAt: now() - 2 * DAY, opens: 3 },
      ])
      sessionStorage.setItem('navigator-tabs-seeded', '1')
    }

    const log = []
    const pages = new Map()
    for (const [id, text] of Object.entries(BODIES)) {
      const entry = SEED.find((candidate) => candidate.id === Number(id))
      pages.set(Number(id), { url: entry.url, title: entry.title, text })
    }
    const surface = fakeSurface({ tabs: SEED.map((entry) => tab(entry.id, entry)), log, pages })
    const undo = new UndoBuffer(60_000, now)
    built = {
      log,
      manager: new TabManager({ surface, memory: tabMemory, undo, now, newId: () => `shot-session-${Date.now()}` }),
    }
    return built
  }

  async function dispatch(message) {
    if (message.kind === 'tab-command') {
      const { manager } = await build()
      return { ok: true, report: await manager.runCommand(message.text) }
    }
    if (message.kind === 'tab-intent') {
      const { manager } = await build()
      return { ok: true, report: await manager.run(message.intent) }
    }
    return { ok: false, error: 'harness: this message kind is not wired' }
  }

  const noop = { addListener() {}, removeListener() {} }
  window.chrome = Object.assign(window.chrome ?? {}, {
    runtime: {
      id: 'navigator-tab-harness',
      sendMessage: async (message) => dispatch(message),
      onMessage: {
        addListener: (listener) => listeners.push(listener),
        removeListener: (listener) => listeners.splice(listeners.indexOf(listener), 1),
      },
    },
    tabs: {
      query: async () => [],
      get: async () => { throw new Error('no tab') },
      update: async () => {},
      create: async () => ({}),
      remove: async () => {},
      sendMessage: async () => { throw new Error('no content script') },
      onCreated: noop,
      onRemoved: noop,
      onUpdated: noop,
      onActivated: noop,
      onMoved: noop,
    },
    tabGroups: { query: async () => [], update: async () => ({}), onUpdated: noop },
  })

  window.__harness = {
    async log() {
      return (await build()).log
    },
  }
})

await page.goto(PANEL, { waitUntil: 'networkidle0' })

const driver = () => {
  const setNative = (input, value) => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const root = () => document.querySelector('main') ?? document
  const byLabel = (label) =>
    Array.from(root().querySelectorAll('button, input, textarea')).find(
      (el) => el.getAttribute('aria-label') === label,
    ) ?? null
  const byText = (text) =>
    Array.from(root().querySelectorAll('button')).find((el) => el.textContent.trim() === text) ?? null

  window.__nav = {
    byLabel,
    type(label, value) {
      const el = byLabel(label)
      if (!el) return false
      setNative(el, value)
      return true
    },
    press(text) {
      const el = byText(text) ?? byLabel(text)
      if (!el) return false
      el.click()
      return true
    },
    heading() {
      return document.querySelector('main h2')?.textContent ?? ''
    },
    text() {
      return document.querySelector('main')?.textContent ?? ''
    },
    attr(name) {
      return document.querySelector(name)?.textContent ?? null
    },
    count(selector) {
      return document.querySelectorAll(selector).length
    },
    data(selector, attribute) {
      return document.querySelector(selector)?.getAttribute(attribute) ?? null
    },
  }
}
await page.evaluate(driver)

const wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function command(text) {
  await page.evaluate((value) => window.__nav.type('Tab command', value), text)
  await wait(150)
  await page.evaluate(() => window.__nav.press('Run'))
  await wait(600)
}

async function snapshot() {
  return page.evaluate(() => {
    const data = (selector, attribute) =>
      document.querySelector(selector)?.getAttribute(attribute) ?? null
    return {
      open: data('[data-open-tabs]', 'data-open-tabs'),
      intent: data('[data-report]', 'data-intent'),
      found: data('[data-found]', 'data-found'),
      where: data('[data-found]', 'data-found-where'),
      stale: data('[data-stale]', 'data-stale'),
      undoSeconds: data('[data-undo-seconds]', 'data-undo-seconds'),
      selected: data('[data-selected]', 'data-selected'),
      report: (document.querySelector('[data-report]')?.textContent ?? '').slice(0, 900),
      alert: document.querySelector('main [role="alert"]')?.textContent ?? '',
      sessions: document.querySelectorAll('main button[aria-label^="Restore session"]').length,
    }
  })
}

await page.click('nav[aria-label="Sections"] button:nth-child(3)')
await wait(800)
const landed = await page.evaluate(() => window.__nav.heading())
const first = await snapshot()
await page.screenshot({ path: SHOT('navigator-tabs-panel.png') })

// Index first: without page text, search can only ever match titles.
await page.evaluate(() => window.__nav.press('Index pages'))
await wait(900)
const indexed = await snapshot()

// Free memory: the suspended count and the bytes estimate.
await page.evaluate(() => window.__nav.press('Free memory'))
await wait(700)
const freed = await snapshot()
await page.screenshot({ path: SHOT('navigator-tabs-memory.png') })

// Duplicate merge on the canonical URL.
await page.evaluate(() => window.__nav.press('Merge duplicates'))
await wait(700)
const merged = await snapshot()

// Semantic search: one hit comes from inside a page, not from its title.
await command('find the tab with the pricing page')
const searched = await snapshot()
await page.screenshot({ path: SHOT('navigator-tabs-search.png') })

// Auto-grouping with an LLM-free fallback name.
await page.evaluate(() => window.__nav.press('Group similar'))
await wait(900)
const grouped = await snapshot()
const groupLog = await page.evaluate(async () => (await window.__harness.log()).filter((entry) => entry.startsWith('group') || entry.startsWith('name')))
await page.screenshot({ path: SHOT('navigator-tabs-grouped.png') })

// Bulk close + the 60 second UNDO banner.
await command('close all YouTube tabs')
const closed = await snapshot()
await page.screenshot({ path: SHOT('navigator-tabs-undo.png') })
await page.evaluate(() => window.__nav.press('Undo'))
await wait(700)
const undone = await snapshot()

// Stale sweeper proposes, the panel acts only on a click.
await command('what is stale from 30 days')
const stale = await snapshot()
await page.screenshot({ path: SHOT('navigator-tabs-stale.png') })

// Selection: tick two tabs and close exactly those.
await page.evaluate(() => {
  window.__nav.byLabel('Select tab 4')?.click()
  window.__nav.byLabel('Select tab 5')?.click()
})
await wait(400)
const selected = await snapshot()
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll('main button')).find(
    (el) => el.textContent.trim() === 'Close',
  )
  button?.click()
})
await wait(700)
const closeSelected = await snapshot()

// Sessions: save, then the panel lists it with Restore/Delete.
await command('save this session for tomorrow')
const saved = await snapshot()
await page.screenshot({ path: SHOT('navigator-tabs-sessions.png') })

// Refusal: an unparseable sentence must not silently do nothing.
await command('sort out my browsing mess')
const refused = await snapshot()

// Reload: the panel rebuilds its own tab list from the manager, sessions persist.
await page.reload({ waitUntil: 'networkidle0' })
await page.evaluate(driver)
await page.click('nav[aria-label="Sections"] button:nth-child(3)')
await wait(900)
const reloaded = await snapshot()

const rows = await page.evaluate(() =>
  Array.from(document.querySelectorAll('main [data-open-tabs] input[type="checkbox"]')).length,
)

await browser.close()

const num = (value) => (value === null ? null : Number(value))
const reopened = (text) => Number((/Reopened (\d+) tab/.exec(text) ?? [0, '0'])[1])

const checks = {
  opensOnTabsTab: landed === 'What should I do with your tabs?',
  listsOpenTabs: num(first.open) === 11 && first.intent === 'list',
  memorySaverReportsBytes: freed.report.includes('MB') && freed.report.includes('freed'),
  duplicatesMerged: num(merged.open) < num(freed.open) && merged.report.toLowerCase().includes('duplicate'),
  pagesWereIndexedBeforeSearch: indexed.report.includes('page') || indexed.report.includes('tab'),
  searchFindsPricingPage: num(searched.found) >= 2 && (searched.where ?? '').includes('content'),
  searchSnippetsShown:
    searched.report.includes('Handbook') && (searched.where ?? '').split(',').includes('content'),
  tabsAutoGrouped: grouped.intent === 'group' && grouped.report.toLowerCase().includes('group'),
  groupsNamed: groupLog.some((entry) => entry.startsWith('group')) && groupLog.some((entry) => entry.startsWith('name')),
  bulkCloseOffersUndo: num(closed.undoSeconds) > 0 && num(closed.open) < num(grouped.open),
  undoReopensEverything:
    undone.intent === 'undo' &&
    num(undone.open) === num(closed.open) + reopened(undone.report) &&
    num(undone.undoSeconds) === null,
  staleSweeperProposesOnly: num(stale.stale) === 1 && stale.report.includes('Timber'),
  selectionClosesExactlyThose: num(selected.selected) === 2 && num(closeSelected.open) === num(undone.open) - 2,
  sessionSaved: saved.sessions === 1 && saved.report.toLowerCase().includes('saved'),
  unparsedCommandRefused: refused.alert.includes('could not tell'),
  sessionsSurviveReload: reloaded.sessions === 1 && num(reloaded.open) > 0 && rows >= 1,
}

console.log(JSON.stringify({ first, indexed, freed, merged, searched, grouped, groupLog, closed, undone, stale, selected, closeSelected, saved, refused, reloaded, rows }, null, 2))
console.log(JSON.stringify(checks, null, 2))

const failed = Object.entries(checks).filter(([, ok]) => ok !== true)
console.log(failed.length === 0 ? 'TABS UI CHECK: PASS' : `TABS UI CHECK: FAIL ${failed.map(([k]) => k).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
