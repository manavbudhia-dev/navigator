import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'

/**
 * Batch 13b (spec §9): both site lists as the user edits them. The rules and
 * the gate are unit-tested; this proves the two Settings cards actually write
 * what they show, that a junk value is refused without touching the list, and
 * that the palette finds each list by the word a person would type for it.
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

const clickTab = (name) =>
  page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button')].find(
      (element) => (element.textContent ?? '').trim() === wanted,
    )
    if (!button) throw new Error(`No tab called "${wanted}"`)
    button.click()
  }, name)

/** Both cards offer an "Add", so a click has to say which card it means. */
const clickInCard = (list, text) =>
  page.evaluate(
    ({ wantedList, wanted }) => {
      const button = [...document.querySelectorAll(`[data-site-list="${wantedList}"] button`)].find(
        (element) => (element.textContent ?? '').trim() === wanted,
      )
      if (!button) throw new Error(`No "${wanted}" button in the ${wantedList} card`)
      button.click()
    },
    { wantedList: list, wanted: text },
  )

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

const stored = (list) =>
  page.evaluate(async (wanted) => {
    const store = await import('/src/safety/siteRulesStore.ts')
    return wanted === 'allow' ? store.loadAllowlist() : store.loadBlocklist()
  }, list)

const shownRows = (list) =>
  page.evaluate(
    (wanted) =>
      [...document.querySelectorAll(`[data-site-rows="${wanted}"] li span:first-child`)].map(
        (element) => element.textContent ?? '',
      ),
    list,
  )

const cardIsVisible = (list) =>
  page.evaluate((wanted) => document.querySelector(`[data-site-list="${wanted}"]`) !== null, list)

const activeTitle = () =>
  page.evaluate(() => {
    const input = document.querySelector('[role="combobox"]')
    const option = document.getElementById(input?.getAttribute('aria-activedescendant') ?? '')
    return (option?.textContent ?? '').trim()
  })

async function openPalette(query) {
  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyK')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await settle()
  await page.evaluate(
    (text) => {
      const input = document.querySelector('[role="combobox"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    query,
  )
  await settle()
}

/** The two lists mean opposite things, so each is tested with its own words. */
const LISTS = [
  {
    list: 'allow',
    empty: 'No sites yet',
    input: '[aria-label="Site to allow"]',
    paste: 'https://www.Shop.test/checkout',
    host: 'shop.test',
    second: 'aaa.test',
    sorted: 'aaa.test,shop.test',
    remove: 'Stop allowing aaa.test',
    afterRemove: 'shop.test',
    clear: 'Stop allowing every site',
    query: 'allowlist',
    title: 'Allow a site in Auto mode',
  },
  {
    list: 'block',
    empty: 'No blocked sites',
    input: '[aria-label="Site to block"]',
    paste: 'https://www.Bank.test/pay-now',
    host: 'bank.test',
    second: 'bbb.test',
    sorted: 'bank.test,bbb.test',
    remove: 'Stop blocking bbb.test',
    afterRemove: 'bank.test',
    clear: 'Stop blocking every site',
    query: 'blocklist',
    title: 'Block a site everywhere',
  },
]

await page.evaluate(async () => {
  const store = await import('/src/safety/siteRulesStore.ts')
  await store.clearAllowlist()
  await store.clearBlocklist()
})
await page.reload({ waitUntil: 'networkidle0' })
await page.click('button[aria-label="Settings"]')
await settle(500)

const checks = {}

for (const spec of LISTS) {
  const key = spec.list
  checks[`${key}CardRenders`] = await cardIsVisible(key)
  checks[`${key}EmptyStateExplains`] = await page.evaluate(
    ({ wanted, phrase }) =>
      (document.querySelector(`[data-site-empty="${wanted}"]`)?.textContent ?? '').includes(phrase),
    { wanted: key, phrase: spec.empty },
  )

  // Something that is not a site is refused, and the list is left alone.
  await typeInto(spec.input, 'not a host')
  await clickInCard(key, 'Add')
  await settle(250)
  checks[`${key}RefusesJunk`] = await page.evaluate(
    (wanted) =>
      /site address/i.test(
        document.querySelector(`[data-site-list="${wanted}"] [role="alert"]`)?.textContent ?? '',
      ),
    key,
  )
  checks[`${key}JunkNotStored`] = (await stored(key)).length === 0

  // Typing a full URL still stores the host, because that is what a rule is.
  await typeInto(spec.input, spec.paste)
  await clickInCard(key, 'Add')
  await settle(250)
  checks[`${key}ShowsHostNotUrl`] = (await shownRows(key)).join(',') === spec.host
  checks[`${key}StoresHost`] = (await stored(key)).join(',') === spec.host
  checks[`${key}InputCleared`] = await page.evaluate(
    (selector) => document.querySelector(selector)?.value === '',
    spec.input,
  )

  // Two rules sort themselves, and the panel survives being closed and reopened.
  await typeInto(spec.input, spec.second)
  await clickInCard(key, 'Add')
  await settle(250)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.click('button[aria-label="Settings"]')
  await settle(500)
  checks[`${key}SurvivesReload`] = (await shownRows(key)).join(',') === spec.sorted

  // One click takes a site away again, and only that one.
  await page.click(`[aria-label="${spec.remove}"]`)
  await settle(250)
  checks[`${key}RemovesOne`] = (await shownRows(key)).join(',') === spec.afterRemove
  checks[`${key}KeepsTheRest`] = (await stored(key)).join(',') === spec.afterRemove
}

// Leave the Settings tab: a palette command is only worth testing if it is the
// thing that brings the tab back, and each list has to answer to its own word.
await clickTab('Agent')
await settle(300)
checks.cardsOnlyOnSettings =
  (await cardIsVisible('allow')) === false && (await cardIsVisible('block')) === false

for (const spec of LISTS) {
  await openPalette(spec.query)
  let landed = false
  for (let step = 0; step < 8 && !landed; step += 1) {
    landed = (await activeTitle()).toLowerCase().startsWith(spec.title.toLowerCase())
    if (landed) break
    await page.keyboard.press('ArrowDown')
    await settle(120)
  }
  checks[`${spec.list}PaletteNamesIt`] = landed
  await page.keyboard.press('Enter')
  await settle(400)
  checks[`${spec.list}PaletteOpensOwnCard`] = await cardIsVisible(spec.list)
}

// Clearing everything is the last thing each card offers, and the last thing checked.
for (const spec of LISTS) {
  await clickInCard(spec.list, spec.clear)
  await settle(250)
  checks[`${spec.list}ClearLeavesHint`] = await page.evaluate(
    (wanted) => document.querySelector(`[data-site-empty="${wanted}"]`) !== null,
    spec.list,
  )
  checks[`${spec.list}ClearIsStored`] = (await stored(spec.list)).length === 0
}

await page.screenshot({ path: join(tmpdir(), 'navigator-sites.png'), fullPage: true })
await browser.close()

const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name)
console.log(JSON.stringify(checks, null, 2))
console.log(
  failed.length === 0
    ? `SITES CHECK: PASS (${Object.keys(checks).length})`
    : `SITES CHECK: FAIL ${failed.join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
