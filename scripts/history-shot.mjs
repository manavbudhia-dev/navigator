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

// Seed the audit log so the History tab renders real rows rather than the empty state.
const seeded = await page.evaluate(async () => {
  const { db } = await import('/src/memory/db.ts')
  await db.audit.clear()
  const now = Date.now()
  const min = 60 * 1000
  const base = { args: {}, risk: 'safe', hardBlock: null, decision: 'allow', ok: true, detail: '' }
  await db.audit.bulkAdd([
    { ...base, at: now - 40 * min, goal: 'Find 3 Chrome extension boilerplates on GitHub', tool: 'read_page', detail: 'Page read: 42 elements' },
    { ...base, at: now - 39 * min, goal: 'Find 3 Chrome extension boilerplates on GitHub', tool: 'type_text', risk: 'low', detail: 'Typed "chrome extension boilerplate" into search' },
    { ...base, at: now - 38 * min, goal: 'Find 3 Chrome extension boilerplates on GitHub', tool: 'click', detail: 'Clicked Search button' },
    { ...base, at: now - 37 * min, goal: 'Find 3 Chrome extension boilerplates on GitHub', tool: 'finish', detail: 'Compared 3 repos by stars' },
    { ...base, at: now - 6 * min, goal: 'Book two seats for Friday', tool: 'read_page', detail: 'Page read: 18 elements' },
    { ...base, at: now - 5 * min, goal: 'Book two seats for Friday', tool: 'click', risk: 'high', decision: 'block', hardBlock: 'payment', ok: false, detail: 'Proceed to Payment is a hard block' },
    { ...base, at: now - 4 * min, goal: 'Book two seats for Friday', tool: 'ask_user', decision: 'approved', detail: 'Which seat class?' },
  ])
  return db.audit.count()
})

await page.click('nav[aria-label="Sections"] button:nth-child(5)')
await new Promise((resolve) => setTimeout(resolve, 500))
await page.click('article button[aria-expanded="false"]')
await new Promise((resolve) => setTimeout(resolve, 300))
await page.screenshot({ path: join(tmpdir(), 'navigator-history.png'), fullPage: true })

await page.click('nav[aria-label="Sections"] button:nth-child(1)')
await new Promise((resolve) => setTimeout(resolve, 400))
await page.screenshot({ path: join(tmpdir(), 'navigator-agent.png'), fullPage: true })

await browser.close()
console.log(`seeded rows: ${seeded}`)
