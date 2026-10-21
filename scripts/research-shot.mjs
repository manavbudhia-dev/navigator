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

const PAGES = {
  'https://metering.example.edu/heat-pump-bill-savings': '/fixtures/research-metering.html',
  'https://heatpumpwatch.example.org/cold-climate-failures': '/fixtures/research-coldclimate.html',
  'https://blog.example.com/sourdough-bread-guide': '/fixtures/research-bread.html',
  'https://forum.example.net/thread/40-percent': '/fixtures/research-forum.html',
}

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
page.on('pageerror', (error) => console.error('[pageerror]', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.error('[console]', message.text())
})
await page.setViewport({ width: 420, height: 980 })

// Seed two finished reports through the real engine, then reopen the panel so
// it loads the newest one from IndexedDB exactly like a returning user would.
await page.goto(PANEL, { waitUntil: 'networkidle0' })
const seeded = await page.evaluate(async (pages) => {
  const { runResearch } = await import('/src/research/engine.ts')
  const { collectLinks, readArticle } = await import('/src/content/article.ts')
  const { rankHits } = await import('/src/research/search.ts')
  const { saveResearchResult } = await import('/src/research/store.ts')
  const { db } = await import('/src/memory/db.ts')

  await db.researchNotes.clear()
  await db.researchRuns.clear()
  await db.settings.bulkDelete(['research-concurrency'])

  const parse = async (path) => {
    const response = await fetch(path)
    return response.ok ? new DOMParser().parseFromString(await response.text(), 'text/html') : null
  }

  const host = {
    async search(query, limit) {
      const doc = await parse('/fixtures/research-serp.html')
      if (doc === null) return []
      return rankHits(collectLinks(doc), query, limit, { baseUrl: location.href })
    },
    async readPage(url) {
      const path = pages[url]
      if (path === undefined) return null
      const doc = await parse(path)
      if (doc === null) return null
      const article = readArticle(doc)
      return { ...article, url }
    },
  }

  const questions = [
    'Do heat pumps actually cut heating bills in cold climates?',
    'What do installers say about heat pump costs?',
  ]
  const ids = []
  for (const [index, question] of questions.entries()) {
    const result = await runResearch({
      id: `seed-${index + 1}`,
      question,
      depth: 'standard',
      host,
      onEvent: () => undefined,
      signal: new AbortController().signal,
    })
    await saveResearchResult(result)
    ids.push(result.id)
  }
  return ids
}, PAGES)

await page.reload({ waitUntil: 'networkidle0' })

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
  }
}
await page.evaluate(driver)

const wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await page.click('nav[aria-label="Sections"] button:nth-child(2)')
await wait(500)
const landedOnResearch = await page.evaluate(() => window.__nav.heading())
await page.screenshot({ path: SHOT('navigator-research-report.png') })

const report = await page.evaluate(() => {
  const answer = document.querySelector('[data-result-id]')
  return {
    resultId: answer?.getAttribute('data-result-id') ?? null,
    hasFindings: answer?.textContent.includes('Findings') ?? false,
    hasContested: answer?.textContent.includes('Contested') ?? false,
    sentences: answer?.querySelectorAll('button').length ?? 0,
    sources: document.querySelectorAll('main a[href^="https://"]').length,
    credibilityBadges: Array.from(document.querySelectorAll('main span[title^="relevance"]')).length,
    pastRuns: document.querySelectorAll('main button[aria-label^="Delete research"]').length,
  }
})

// Hovering a sentence must name the sources behind it (spec §7 source panel).
const sentence = await page.$('[data-result-id] button')
if (sentence === null) throw new Error('No sentence to hover in the seeded report')
await page.evaluate(() => {
  const panel = document.querySelector('main')
  panel?.scrollTo(0, 0)
})
await sentence.hover()
await wait(300)
const hovered = await page.evaluate(() => {
  const sections = Array.from(document.querySelectorAll('main section'))
  const panel = sections.find((el) => el.textContent.includes('Source panel'))
  return { text: panel?.textContent ?? '', cited: (panel?.querySelectorAll('a[href^="https://"]').length ?? 0) > 0 }
})

// Export: switch to JSON with a user schema, preview, copy.
await page.evaluate(() => window.__nav.press('JSON'))
await wait(300)
await page.evaluate(() => window.__nav.type('JSON output schema', '{"summary":"answer","refs":"sources"}'))
await wait(300)
await page.evaluate(() => window.__nav.press('Preview'))
await wait(300)
const exported = await page.evaluate(() => {
  const pre = document.querySelector('main pre')
  return {
    previewHead: (pre?.textContent ?? '').slice(0, 40),
    schemaHonoured: (pre?.textContent ?? '').includes('"summary"'),
  }
})
const copyOk = await page.evaluate(() => window.__nav.press('Copy'))
await wait(300)
const copied = await page.evaluate(() => window.__nav.text().includes('Copied'))
await page.screenshot({ path: SHOT('navigator-research-export.png') })

const readTabs = () =>
  page.evaluate(() => document.querySelector('main [data-tabs]')?.getAttribute('data-tabs') ?? null)

// Stepper is persisted, so a reload must remember the tab budget.
await page.evaluate(() => window.__nav.press('More background tabs'))
await wait(300)
const afterPlus = await readTabs()

// Without a live service worker the run must refuse loudly, never half-start.
await page.evaluate(() => window.__nav.type('Research question', 'Best heat pump brands?'))
await page.evaluate(() => window.__nav.press('Research'))
await wait(400)
const guarded = await page.evaluate(
  () => document.querySelector('main [role="alert"]')?.textContent ?? '',
)

// Reopening an older run swaps the whole report.
const reopened = await page.evaluate(async () => {
  const buttons = Array.from(document.querySelectorAll('main button')).filter((el) =>
    el.textContent.includes('Do heat pumps actually cut'),
  )
  if (buttons.length === 0) return { clicked: false, heading: '' }
  buttons[0].click()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const answer = document.querySelector('[data-result-id]')
  return {
    clicked: true,
    resultId: answer?.getAttribute('data-result-id') ?? null,
    contested: answer?.textContent.includes('Contested') ?? false,
  }
})

const stored = await page.evaluate(async () => {
  const { listResearchRuns } = await import('/src/research/store.ts')
  const rows = await listResearchRuns()
  const noteRows = await (await import('/src/memory/db.ts')).db.researchNotes.count()
  return { runs: rows.length, notes: noteRows }
})

const concurrencyAfterReload = await (async () => {
  await page.reload({ waitUntil: 'networkidle0' })
  await page.evaluate(driver)
  await page.click('nav[aria-label="Sections"] button:nth-child(2)')
  await wait(400)
  return readTabs()
})()

await browser.close()

const checks = {
  opensOnResearchTab: landedOnResearch === 'What should I research?',
  storedReportRendered: report.resultId === seeded[1] && report.hasFindings,
  contestedBlockShown: report.hasContested,
  sentencesAreHoverTargets: report.sentences >= 3,
  sourcesAreLinks: report.sources >= 2,
  credibilityShownPerSource: report.credibilityBadges >= 2,
  pastRunsListed: report.pastRuns >= 2,
  hoverFillsSourcePanel: hovered.cited && hovered.text.includes('Source panel'),
  jsonPreviewShown: exported.previewHead.startsWith('{') && exported.schemaHonoured,
  copyButtonWorked: copyOk === true && copied,
  stepperIncreases: afterPlus === '5',
  stepperPersistedAcrossReload: concurrencyAfterReload === '5',
  runRefusedOutsideExtension: guarded.includes('Not running inside Chrome'),
  olderRunReopens: reopened.clicked && reopened.resultId === seeded[0],
  everythingStored: stored.runs === 2 && stored.notes >= 4,
}

console.log(JSON.stringify({ seeded, report, hovered, exported, afterPlus, guarded, reopened, stored, concurrencyAfterReload }, null, 2))
console.log(JSON.stringify(checks, null, 2))

const failed = Object.entries(checks).filter(([, ok]) => ok !== true)
console.log(failed.length === 0 ? 'RESEARCH UI CHECK: PASS' : `RESEARCH UI CHECK: FAIL ${failed.map(([k]) => k).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
