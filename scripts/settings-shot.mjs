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

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))
const clickByText = (text) =>
  page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button')].find(
      (element) => (element.textContent ?? '').trim() === wanted,
    )
    if (!button) throw new Error(`No button labelled "${wanted}"`)
    button.click()
  }, text)

// Start with no price stored, which is what a fresh install looks like.
await page.evaluate(async () => {
  const { clearPricing } = await import('/src/memory/cost.ts')
  await clearPricing()
})
await page.reload({ waitUntil: 'networkidle0' })
await page.click('button[aria-label="Settings"]')
await settle(600)

const before = await page.evaluate(() => ({
  hasCard: document.querySelector('[data-pricing]') !== null,
  symbol: document.querySelector('[aria-label="Currency symbol"]')?.value ?? '',
  clearButton: [...document.querySelectorAll('button')].some(
    (element) => (element.textContent ?? '').trim() === 'Stop estimating',
  ),
}))

// A price with no currency symbol is not a price.
await page.type('[aria-label="Price per million input tokens"]', '120')
await clickByText('Save price')
const rejected = await page.evaluate(() => document.querySelector('[data-pricing] [role="alert"]')?.textContent ?? '')

await page.type('[aria-label="Currency symbol"]', '₹')
await page.type('[aria-label="Price per million output tokens"]', '480')
await clickByText('Save price')
await settle(200)
const savedLabel = await page.evaluate(
  () =>
    [...document.querySelectorAll('[data-pricing] button')].find((element) =>
      /price/i.test(element.textContent ?? ''),
    )?.textContent ?? '',
)

// The save has to survive a reload, because the panel closes between tasks.
await page.reload({ waitUntil: 'networkidle0' })
await page.click('button[aria-label="Settings"]')
await settle(600)
const after = await page.evaluate(async () => {
  const { loadPricing } = await import('/src/memory/cost.ts')
  return {
    stored: await loadPricing(),
    symbol: document.querySelector('[aria-label="Currency symbol"]')?.value ?? '',
    clearButton: [...document.querySelectorAll('button')].some(
      (element) => (element.textContent ?? '').trim() === 'Stop estimating',
    ),
  }
})

const out = join(tmpdir(), 'navigator-settings.png')
await page.screenshot({ path: out, fullPage: true })
await browser.close()

const checks = {
  costCardRenders: before.hasCard,
  startsWithoutAPrice: before.symbol === '' && !before.clearButton,
  refusesIncompletePrice: rejected.includes('currency symbol'),
  buttonConfirmsSave: savedLabel === 'Price saved',
  pricePersisted:
    after.stored !== null &&
    after.stored.symbol === '₹' &&
    after.stored.inputPerMillion === 120 &&
    after.stored.outputPerMillion === 480,
  formRefillsOnOpen: after.symbol === '₹' && after.clearButton,
}

const failed = Object.entries(checks).filter(([, ok]) => !ok)
console.log(JSON.stringify({ before, rejected, savedLabel, after, checks }, null, 2))
console.log(out)
console.log(
  failed.length === 0
    ? 'SETTINGS CHECK: PASS'
    : `SETTINGS CHECK: FAIL ${failed.map(([name]) => name).join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
