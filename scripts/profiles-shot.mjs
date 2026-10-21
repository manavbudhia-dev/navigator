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

const PASSPHRASE = 'staging passphrase 1'
const SHOT = (name) => join(tmpdir(), name)

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--force-device-scale-factor=1'],
})

const page = await browser.newPage()
await page.setViewport({ width: 420, height: 940 })

// Start from an empty vault so the run is repeatable.
await page.goto('http://localhost:5173/src/sidepanel/index.html', { waitUntil: 'networkidle0' })
await page.evaluate(async () => {
  const { db } = await import('/src/memory/db.ts')
  await db.vault.clear()
  await db.settings.bulkDelete(['vault-salt', 'vault-check'])
})
await page.reload({ waitUntil: 'networkidle0' })

/** React owns these inputs, so type through the native setter + input event. */
const driver = () => {
  const setNative = (input, value) => {
    const proto =
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  window.__nav = {
    field(label) {
      const span = Array.from(document.querySelectorAll('label > span')).find(
        (el) => el.textContent.trim() === label,
      )
      const input = span?.parentElement.querySelector('input, textarea, select') ?? null
      if (input) setNative(input, this.next ?? '')
      return input !== null
    },
    type(label, value) {
      this.next = value
      const found = this.field(label)
      this.next = undefined
      return found
    },
    press(text) {
      const button = Array.from(document.querySelectorAll('button')).find((el) =>
        el.textContent.trim().includes(text),
      )
      if (!button) return false
      button.click()
      return true
    },
    heading() {
      return document.querySelector('main h2')?.textContent ?? ''
    },
    value(label) {
      const span = Array.from(document.querySelectorAll('label > span')).find(
        (el) => el.textContent.trim() === label,
      )
      const input = span?.parentElement.querySelector('input, textarea')
      return input?.value ?? null
    },
  }
}
await page.evaluate(driver)

const wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const step = async (label, ms = 400) => {
  await wait(ms)
  const ok = await page.evaluate((name) => window.__nav.press(name), label)
  await wait(600)
  return ok
}

await page.click('nav[aria-label="Sections"] button:nth-child(4)')
await wait(600)
const createHeading = await page.evaluate(() => window.__nav.heading())
await page.screenshot({ path: SHOT('navigator-profiles-create.png') })

await page.evaluate((pass) => {
  window.__nav.type('Choose a passphrase', pass)
  window.__nav.type('Repeat it', pass)
}, PASSPHRASE)
const createdVault = await step('Create vault')

await page.evaluate(() => {
  const name = document.querySelector('input[placeholder^="e.g. Personal"]')
  if (name) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(name, 'Personal')
    name.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
const createdProfile = await step('Create profile')

await page.evaluate(() => {
  window.__nav.type('First name', 'Manav')
  window.__nav.type('Last name', 'Shah')
  window.__nav.type('Email', 'manav@example.com')
  window.__nav.type('Phone', '+91 98200 00000')
})
await page.screenshot({ path: SHOT('navigator-profiles-editor.png') })
const saved = await step('Save')

const atRest = await page.evaluate(async () => {
  const { db } = await import('/src/memory/db.ts')
  const rows = await db.vault.toArray()
  return {
    rowCount: rows.length,
    leaksPlaintext: JSON.stringify(rows).includes('manav@example.com'),
    hasCipher: rows.every((row) => typeof row.cipher === 'string' && row.cipher.length > 20),
  }
})

await step('Back')
await step('Lock')
const lockedHeading = await page.evaluate(() => window.__nav.heading())
await page.screenshot({ path: SHOT('navigator-profiles-locked.png') })

await page.evaluate((pass) => window.__nav.type('Passphrase', pass), PASSPHRASE)
await step('Unlock')
const unlocked = await page.evaluate(() => ({
  heading: window.__nav.heading(),
  cards: Array.from(document.querySelectorAll('main button')).filter((b) =>
    b.textContent.includes('fields'),
  ).length,
}))

const checks = {
  startsAtCreateForm: createHeading === 'Profile vault',
  vaultCreated: createdVault === true,
  profileCreated: createdProfile === true,
  profileSaved: saved === true,
  nothingReadableAtRest: atRest.leaksPlaintext === false && atRest.hasCipher === true,
  oneRowStored: atRest.rowCount === 1,
  lockShowsUnlockForm: lockedHeading === 'Vault locked',
  unlockListsProfiles: unlocked.heading === 'Profiles' && unlocked.cards === 1,
}

await browser.close()
console.log(JSON.stringify({ atRest, unlocked }, null, 2))
console.log(JSON.stringify(checks, null, 2))

const failed = Object.entries(checks).filter(([, ok]) => ok !== true)
console.log(failed.length === 0 ? 'PROFILES CHECK: PASS' : `PROFILES CHECK: FAIL ${failed.map(([k]) => k).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
