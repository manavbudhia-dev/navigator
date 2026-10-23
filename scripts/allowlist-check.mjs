import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'

/**
 * Batch 12b (spec §9): the Auto mode site list as the user edits it. The rules
 * and the gate are unit-tested; this proves the Settings card actually writes
 * them, that what is on screen is what is stored, and that the palette can open
 * the list by the word "allowlist".
 */

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

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms))
const clickByText = (text) =>
  page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button')].find(
      (element) => (element.textContent ?? '').trim() === wanted,
    )
    if (!button) throw new Error(`No button labelled "${wanted}"`)
    button.click()
  }, text)

/** Replace what is in a React-controlled input rather than appending to it. */
const typeInto = (selector, value) =>
  page.evaluate(
    ({ wantedSelector, text }) => {
      const input = document.querySelector(wantedSelector)
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    { wantedSelector: selector, text: value },
  )

const storedList = () =>
  page.evaluate(async () => {
    const { loadAllowlist } = await import('/src/safety/allowlistStore.ts')
    return loadAllowlist()
  })

const shownRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-allowlist-rows] li span:first-child')].map(
      (element) => element.textContent ?? '',
    ),
  )

// A fresh install has no allowed sites, which is what the card has to say.
await page.evaluate(async () => {
  const { clearAllowlist } = await import('/src/safety/allowlistStore.ts')
  await clearAllowlist()
})
await page.reload({ waitUntil: 'networkidle0' })
await page.click('button[aria-label="Settings"]')
await settle(500)

const checks = {}
checks.cardRenders = await page.evaluate(() => document.querySelector('[data-allowlist]') !== null)
checks.emptyStateExplains = await page.evaluate(
  () => /No sites yet/i.test(document.querySelector('[data-allowlist-empty]')?.textContent ?? ''),
)

// Typing a full URL still stores the host, because that is what a rule is.
await page.type('[aria-label="Site to allow"]', 'https://www.Shop.test/checkout')
await clickByText('Add')
await settle(250)
checks.rowShowsHost = (await shownRows()).join(',') === 'shop.test'
checks.hostIsStored = (await storedList()).join(',') === 'shop.test'
checks.inputCleared = await page.evaluate(
  () => document.querySelector('[aria-label="Site to allow"]')?.value === '',
)

// Something that is not a site is refused, and the list is left alone.
await typeInto('[aria-label="Site to allow"]', 'not a host')
await clickByText('Add')
await settle(250)
checks.refusesJunk = await page.evaluate(() =>
  /site address/i.test(document.querySelector('[data-allowlist] [role="alert"]')?.textContent ?? ''),
)
checks.listUntouchedByJunk = (await shownRows()).join(',') === 'shop.test'

// Two rules sort themselves, and the panel survives being closed and reopened.
await typeInto('[aria-label="Site to allow"]', 'aaa.test')
await clickByText('Add')
await settle(250)
await page.reload({ waitUntil: 'networkidle0' })
await page.click('button[aria-label="Settings"]')
await settle(500)
checks.survivesReload = (await shownRows()).join(',') === 'aaa.test,shop.test'

// One click takes a site away again.
await page.click('[aria-label="Stop allowing aaa.test"]')
await settle(250)
checks.removesOne = (await shownRows()).join(',') === 'shop.test'
checks.stillStoresTheRest = (await storedList()).join(',') === 'shop.test'

// The palette is the keyboard-first way in, so it has to find this by name.
// Leave the Settings tab first: the command is only worth testing if it is the
// thing that brings the tab back.
await clickByText('Agent')
await settle(300)
checks.listOnlyOnSettings = await page.evaluate(() => document.querySelector('[data-allowlist]') === null)
await page.keyboard.down('Control')
await page.keyboard.down('Shift')
await page.keyboard.press('KeyK')
await page.keyboard.up('Shift')
await page.keyboard.up('Control')
await settle()
await page.evaluate(() => {
  const input = document.querySelector('[role="combobox"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, 'allowlist')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await settle()
const activeTitle = () =>
  page.evaluate(() => {
    const input = document.querySelector('[role="combobox"]')
    const option = document.getElementById(input?.getAttribute('aria-activedescendant') ?? '')
    return (option?.textContent ?? '').trim()
  })

checks.paletteListsIt = await page.evaluate(() =>
  [...document.querySelectorAll('[role="option"]')].some((option) =>
    (option.textContent ?? '').startsWith('Allow a site in Auto mode'),
  ),
)
// Walk down to it: the palette always offers "Start task" for a typed phrase,
// and greyed rows are skipped, so the command is a few arrows away.
let landed = false
for (let step = 0; step < 6 && !landed; step += 1) {
  landed = (await activeTitle()).startsWith('Allow a site in Auto mode')
  if (landed) break
  await page.keyboard.press('ArrowDown')
  await settle(120)
}
checks.paletteNamesIt = landed
await page.keyboard.press('Enter')
await settle(400)
checks.paletteOpensSettings = await page.evaluate(
  () => document.querySelector('[data-allowlist]') !== null,
)

// Clearing everything is the last thing the card offers, and the last thing checked.
await page.evaluate(() => {
  [...document.querySelectorAll('[data-allowlist] button')].find(
    (element) => (element.textContent ?? '').trim() === 'Stop allowing every site',
  )?.click()
})
await settle(250)
checks.clearLeavesHint = await page.evaluate(() => document.querySelector('[data-allowlist-empty]') !== null)
checks.clearIsStored = (await storedList()).length === 0

await page.screenshot({ path: join(tmpdir(), 'navigator-allowlist.png'), fullPage: true })
await browser.close()

const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name)
console.log(JSON.stringify(checks, null, 2))
console.log(
  failed.length === 0 ? 'ALLOWLIST CHECK: PASS' : `ALLOWLIST CHECK: FAIL ${failed.join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
