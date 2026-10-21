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

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--force-device-scale-factor=1'],
})

const page = await browser.newPage()
await page.setViewport({ width: 420, height: 940 })
await page.goto('http://localhost:5173/src/sidepanel/index.html', { waitUntil: 'networkidle0' })

// Draw a real picture in the page: the audit log stores screenshots as data URLs.
const PIXEL = await page.evaluate(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser')
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(0, 0, 64, 40)
  ctx.fillStyle = '#38bdf8'
  ctx.fillRect(4, 4, 56, 6)
  ctx.fillStyle = '#e2e8f0'
  ctx.fillRect(4, 14, 30, 22)
  return canvas.toDataURL('image/jpeg', 0.8)
})

// Seed the audit log so the History tab renders real rows rather than the empty state.
const seeded = await page.evaluate(async (thumb) => {
  const { db } = await import('/src/memory/db.ts')
  await db.audit.clear()
  const now = Date.now()
  const min = 60 * 1000
  const base = { args: {}, risk: 'safe', hardBlock: null, decision: 'allow', ok: true, detail: '' }
  const shop = { runId: 'run-shop', url: 'https://shop.test/checkout' }
  const book = { runId: 'run-book', url: 'https://events.test/seats' }
  const find = 'Find 3 Chrome extension boilerplates on GitHub'
  const seats = 'Book two seats for Friday'
  await db.audit.bulkAdd([
    { ...base, ...shop, thumb, at: now - 40 * min, goal: find, tool: 'read_page', detail: 'Page read: 42 elements', ms: 180, promptTokens: 1800, completionTokens: 90 },
    { ...base, ...shop, thumb, at: now - 39 * min, goal: find, tool: 'type_text', risk: 'low', detail: 'Typed "chrome extension boilerplate" into search', ms: 240 },
    { ...base, ...shop, at: now - 38 * min, goal: find, tool: 'click', risk: 'low', detail: 'Clicked Search button', ms: 95, promptTokens: 2100, completionTokens: 40 },
    { ...base, ...shop, at: now - 37 * min, goal: find, tool: 'finish', detail: 'Compared 3 repos by stars', promptTokens: 1500, completionTokens: 210 },
    { ...base, ...book, thumb, at: now - 6 * min, goal: seats, tool: 'read_page', detail: 'Page read: 18 elements', ms: 120 },
    { ...base, ...book, thumb, at: now - 5 * min, goal: seats, tool: 'click', risk: 'high', decision: 'block', hardBlock: 'payment', ok: false, detail: 'Proceed to Payment is a hard block', ms: 0 },
    { ...base, ...book, at: now - 4 * min, goal: seats, tool: 'ask_user', decision: 'approved', detail: 'Which seat class?' },
  ])
  return db.audit.count()
}, PIXEL)

// Open the History tab and expand every run.
await page.click('nav[aria-label="Sections"] button:nth-child(5)')
await new Promise((resolve) => setTimeout(resolve, 500))
await page.evaluate(() => {
  for (const button of document.querySelectorAll('article > button[aria-expanded="false"]')) {
    button.click()
  }
})
await new Promise((resolve) => setTimeout(resolve, 300))

const shots = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('article li')]
  const text = (rows) => rows.map((row) => row.textContent ?? '')
  return {
    runs: document.querySelectorAll('article[data-run]').length,
    rows: rows.length,
    thumbs: rows.filter((row) => row.querySelector('img') !== null).length,
    thumbsDecoded: rows.filter((row) => {
      const img = row.querySelector('img')
      return img !== null && img.naturalWidth > 0
    }).length,
    withSite: text(rows).filter((t) => /shop\.test|events\.test/.test(t)).length,
    withMillis: text(rows).filter((t) => /\d+ ms/.test(t)).length,
  }
})

// Export must produce real JSON carrying the seeded evidence.
const exported = await page.evaluate(async () => {
  const { buildAuditExport } = await import('/src/memory/export.ts')
  const json = await buildAuditExport()
  const parsed = JSON.parse(json)
  return {
    bytes: json.length,
    app: parsed.app,
    rows: parsed.rows,
    first: parsed.log[0]?.tool,
    withUrl: parsed.log.filter((row) => typeof row.url === 'string').length,
    withThumb: parsed.log.filter((row) => typeof row.thumb === 'string').length,
    runIds: [...new Set(parsed.log.map((row) => row.runId))].sort(),
  }
})

// The thumbnail is the only way to see the picture, so it has to open.
await page.click('article li button[aria-label^="Show the screenshot"]')
await new Promise((resolve) => setTimeout(resolve, 250))
const expanded = await page.evaluate(
  () => document.querySelector('article li button[aria-expanded="true"]') !== null,
)

await page.screenshot({ path: join(tmpdir(), 'navigator-history.png'), fullPage: true })

await page.click('nav[aria-label="Sections"] button:nth-child(1)')
await new Promise((resolve) => setTimeout(resolve, 400))
await page.screenshot({ path: join(tmpdir(), 'navigator-agent.png'), fullPage: true })

await browser.close()

const checks = {
  sevenRowsSeeded: seeded === 7,
  groupedByRunId: shots.runs === 2 && exported.runIds.join(',') === 'run-book,run-shop',
  everyRowShowsItsSite: shots.rows === 7 && shots.withSite === 7,
  picturesShow: shots.thumbs === 4 && shots.thumbsDecoded === 4,
  thumbnailOpens: expanded,
  durationsShow: shots.withMillis === 5,
  exportCarriesEvidence:
    exported.app === 'navigator' &&
    exported.rows === 7 &&
    exported.first === 'read_page' &&
    exported.withUrl === 7 &&
    exported.withThumb === 4 &&
    exported.bytes > 1000,
}

const failed = Object.entries(checks).filter(([, ok]) => !ok)
console.log(JSON.stringify({ seeded, ...shots, exported, expanded, checks }, null, 2))
console.log(
  failed.length === 0
    ? 'AUDIT CHECK: PASS'
    : `AUDIT CHECK: FAIL ${failed.map(([name]) => name).join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
