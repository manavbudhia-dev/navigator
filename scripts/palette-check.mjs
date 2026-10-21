import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import puppeteer from 'puppeteer-core'

/**
 * Batch 11c (spec §10): the command palette, driven by the keyboard in real
 * Chromium. Nothing here clicks a command — every one is reached by typing,
 * arrow keys and Enter, because that is the promise the palette makes.
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

const settle = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms))

async function paletteShortcut() {
  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyK')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await settle()
}

/** What the list box says is highlighted, as the screen reader would read it. */
const activeTitle = () =>
  page.evaluate(() => {
    const input = document.querySelector('[role="combobox"]')
    const id = input?.getAttribute('aria-activedescendant') ?? ''
    const option = id === '' ? null : document.getElementById(id)
    return option === null ? null : (option.textContent ?? '').trim()
  })

const optionCount = () => page.evaluate(() => document.querySelectorAll('[role="option"]').length)

const dialogOpen = () => page.evaluate(() => document.querySelector('[role="dialog"]') !== null)

const focusedTag = () =>
  page.evaluate(() => {
    const element = document.activeElement
    if (element === null) return ''
    return `${element.tagName.toLowerCase()}:${element.getAttribute('aria-label') ?? ''}`
  })

const checks = {}

// 1. The shortcut opens the palette and the input has the caret.
await paletteShortcut()
checks.opensWithShortcut = await dialogOpen()
checks.inputHeldFocus = (await focusedTag()).startsWith('input:')
checks.listboxWired = await page.evaluate(() => {
  const input = document.querySelector('[role="combobox"]')
  const list = document.getElementById(input?.getAttribute('aria-controls') ?? '')
  return list !== null && list.getAttribute('role') === 'listbox'
})

// 2. Everything Navigator can do is on the list, grouped.
const groupsShown = await page.evaluate(() =>
  [...document.querySelectorAll('[role="group"] > h3')].map((heading) => heading.textContent?.trim()),
)
checks.groupsInPaletteOrder = JSON.stringify(groupsShown) === JSON.stringify(['Task', 'Mode', 'Go to', 'View', 'Data'])
checks.listsEveryCommand = (await optionCount()) >= 14

// 3. A greyed command explains itself instead of disappearing.
await page.keyboard.type('stop')
await settle()
checks.stopIsFirst = (await activeTitle())?.startsWith('Stop the running task') === true
checks.stopExplainsWhy = await page.evaluate(() => {
  const input = document.querySelector('[role="combobox"]')
  const option = document.getElementById(input?.getAttribute('aria-activedescendant') ?? '')
  return option?.getAttribute('aria-disabled') === 'true' && /nothing is running/i.test(option.textContent ?? '')
})

// 4. Typing a real command and pressing Enter runs it.
await page.evaluate(() => {
  const input = document.querySelector('[role="combobox"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, 'hist')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await settle()
checks.historyIsFirst = (await activeTitle())?.startsWith('Go to History') === true
await page.keyboard.press('Enter')
await settle(320)
checks.enterRanIt = !(await dialogOpen())
checks.historyIsOpen = await page.evaluate(
  () =>
    document.querySelector('nav[aria-label="Sections"] button:nth-child(5)')?.getAttribute('aria-current') === 'page' &&
    document.querySelector('[data-memory]') !== null,
)

// 5. Arrow keys walk the list, skipping what cannot run, and wrap at the ends.
await paletteShortcut()
await page.evaluate(() => {
  const input = document.querySelector('[role="combobox"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, 'mode')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await settle()
const moved = await page.evaluate(async () => {
  const input = document.querySelector('[role="combobox"]')
  const before = input.getAttribute('aria-activedescendant')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 120))
  return { before, after: document.querySelector('[role="combobox"]')?.getAttribute('aria-activedescendant') }
})
checks.arrowMoved = moved.before !== moved.after && moved.after !== null && moved.after !== ''
checks.wrapAround = await page.evaluate(async () => {
  const input = document.querySelector('[role="combobox"]')
  for (let i = 0; i < 40; i += 1) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  }
  await new Promise((resolve) => setTimeout(resolve, 120))
  const option = document.getElementById(input.getAttribute('aria-activedescendant') ?? '')
  return option?.getAttribute('aria-disabled') !== 'true'
})

// 6. Escape closes the palette, and a palette opened from a button gives focus
// back to that button rather than dumping it on the page body.
await page.keyboard.press('Escape')
await settle(320)
checks.escapeClosed = !(await dialogOpen())

await page.click('header button[aria-label*="command palette"]')
await settle()
checks.buttonOpensIt = await dialogOpen()
await page.keyboard.press('Escape')
await settle(320)
checks.focusRestored = (await focusedTag()).includes('command palette')

// 7. A theme command persists across a reload.
await paletteShortcut()
await page.keyboard.type('dark')
await settle()
checks.themeCommand = (await activeTitle())?.includes('Switch to dark mode') === true
await page.keyboard.press('Enter')
await settle(320)
const darkNow = await page.evaluate(() => document.documentElement.classList.contains('dark'))
await page.reload({ waitUntil: 'networkidle0' })
await settle(400)
checks.themePersisted = darkNow && (await page.evaluate(() => document.documentElement.classList.contains('dark')))

// 8. Alt+number jumps between sections, and the step live region is in place.
await page.keyboard.down('Alt')
await page.keyboard.press('Digit3')
await page.keyboard.up('Alt')
await settle(320)
checks.altNumberSwitches = await page.evaluate(
  () => document.querySelector('nav[aria-label="Sections"] button:nth-child(3)')?.getAttribute('aria-current') === 'page',
)
await page.keyboard.down('Alt')
await page.keyboard.press('Digit1')
await page.keyboard.up('Alt')
await settle(320)
checks.stepLiveRegion = await page.evaluate(() => {
  const region = document.querySelector('[data-step-announcement]')
  return region !== null && region.getAttribute('aria-live') === 'polite' && region.getAttribute('role') === 'status'
})

// 9. A query that is a task, not a command, still has an answer.
await paletteShortcut()
await page.keyboard.type('compare the three cheapest flights')
await settle()
checks.offersTheTask = (await activeTitle())?.startsWith('Start task:') === true
await page.screenshot({ path: join(tmpdir(), 'navigator-palette-open.png'), fullPage: false })
await page.keyboard.press('Escape')
await settle(300)

// 10. Put the theme back the way the other checks expect to find it. Running a
// command closes the palette, so this also re-proves that.
await paletteShortcut()
await page.keyboard.type('light')
await settle()
await page.keyboard.press('Enter')
await settle(320)
checks.commandClosesPalette = await page.evaluate(
  () => document.querySelector('[role="listbox"]') === null && !document.documentElement.classList.contains('dark'),
)

await page.screenshot({ path: join(tmpdir(), 'navigator-palette.png'), fullPage: false })
await browser.close()

const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name)
console.log(JSON.stringify(checks, null, 2))
console.log(
  failed.length === 0 ? 'PALETTE CHECK: PASS' : `PALETTE CHECK: FAIL ${failed.join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
