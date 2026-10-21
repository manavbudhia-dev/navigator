import { existsSync } from 'node:fs'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

/**
 * What a site would write itself. The fixture is plain markup because the crxjs
 * dev middleware rewrites every script tag in a root HTML file — and the point of
 * the check is that our synthetic events reach ordinary page listeners.
 */
async function wirePage() {
  window.__seen = []
  const note = (what) => window.__seen.push(what)
  const byId = (id) => document.getElementById(id)

  byId('nav').addEventListener('mouseover', () => {
    note('nav-mouseover')
    byId('nav').classList.add('open')
  })
  byId('send').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') note(`send-keydown:${event.code}`)
  })
  byId('country').addEventListener('change', () => note('country-change'))
  byId('terms').addEventListener('change', () => note('terms-change'))
  byId('cv').addEventListener('change', () => note('cv-change'))

  const card = byId('card')
  const bin = byId('bin')
  card.addEventListener('dragstart', () => {
    note('card-dragstart')
    bin.classList.add('hot')
  })
  bin.addEventListener('dragenter', () => note('bin-dragenter'))
  bin.addEventListener('dragover', (event) => event.preventDefault())
  bin.addEventListener('drop', (event) => {
    event.preventDefault()
    note('bin-drop')
    bin.append(card)
  })

  // A control that only arrives later, so wait_for has something to wait for.
  setTimeout(() => {
    const late = document.createElement('button')
    late.id = 'late'
    late.textContent = 'Invoice is ready'
    byId('late-holder').append(late)
  }, 400)
}

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })
await page.goto('http://localhost:5173/fixtures/interaction.html', { waitUntil: 'networkidle0' })
await page.evaluate(wirePage)

// Same trick as actions-check: import the module through the specifier
// actions.ts itself receives, so the snapshot is the one instance.
const actionsSrc = await (await fetch('http://localhost:5173/src/content/actions.ts')).text()
const pageStateUrl = actionsSrc.match(/from "([^"]*perception\/pageState\.ts[^"]*)"/)?.[1]
if (!pageStateUrl) throw new Error('Could not find pageState import in transformed actions.ts')

const report = await page.evaluate(
  async (psUrl) => {
    const { buildPageState, getSnapshot } = await import(psUrl)
    const { performAct } = await import('/src/content/actions.ts')
    const { waitForInPage } = await import('/src/content/waitFor.ts')

    // Indices come from a fresh snapshot each time: revealing a menu adds controls.
    const indexOf = (id) => {
      buildPageState(document, { includeOffViewport: true, maxElements: 400, tokenBudget: 4000 })
      return getSnapshot().find((el) => el.attributes['id'] === id)?.index ?? -1
    }

    const byId = (id) => document.getElementById(id)
    const menu = byId('menu')
    const country = byId('country')
    const terms = byId('terms')
    const cv = byId('cv')
    const bin = byId('bin')
    const card = byId('card')

    const hover = performAct({ type: 'hover', index: indexOf('menu-button') })
    const menuOpened = getComputedStyle(menu).display !== 'none'
    const press = performAct({ type: 'press_key', key: 'Enter', index: indexOf('send') })
    const select = performAct({ type: 'select', index: indexOf('country'), value: 'germany' })
    const checkBox = performAct({ type: 'check', index: indexOf('terms'), checked: true })
    const untickRadio = performAct({ type: 'check', index: indexOf('plan-a'), checked: false })
    const wrongControl = performAct({
      type: 'upload',
      index: indexOf('country'),
      file: { name: 'a.txt', mime: 'text/plain', text: 'x' },
    })
    const upload = performAct({
      type: 'upload',
      index: indexOf('cv'),
      file: { name: 'resume.pdf', mime: 'application/pdf', text: 'A. Candidate' },
    })
    const drag = performAct({ type: 'drag', fromIndex: indexOf('card'), toIndex: indexOf('bin') })

    const selectorWait = await waitForInPage('selector', '#late', 4000)
    const textWait = await waitForInPage('text', 'Invoice is ready', 1000)
    const quietWait = await waitForInPage('quiet', '', 3000)
    const missingWait = await waitForInPage('selector', '#never', 300)
    const badWait = await waitForInPage('selector', '##', 300)

    return {
      hover,
      menuOpened,
      press,
      select,
      countryValue: country.value,
      checkBox,
      termsChecked: terms.checked,
      untickRadio,
      wrongControl,
      upload,
      cvFiles: cv.files.length,
      cvName: cv.files[0]?.name ?? '',
      cvSize: cv.files[0]?.size ?? 0,
      cvType: cv.files[0]?.type ?? '',
      drag,
      cardInBin: bin.contains(card),
      selectorWait,
      textWait,
      quietWait,
      missingWait,
      badWait,
      seen: window.__seen,
    }
  },
  pageStateUrl,
)

console.log(JSON.stringify(report, null, 2))

const ok =
  report.hover.ok === true &&
  report.menuOpened === true &&
  report.seen.includes('nav-mouseover') &&
  report.press.ok === true &&
  report.seen.includes('send-keydown:Enter') &&
  report.select.ok === true &&
  report.countryValue === 'de' &&
  report.seen.includes('country-change') &&
  report.checkBox.ok === true &&
  report.termsChecked === true &&
  report.seen.includes('terms-change') &&
  report.untickRadio.ok === false &&
  report.wrongControl.ok === false &&
  report.upload.ok === true &&
  report.cvFiles === 1 &&
  report.cvName === 'resume.pdf' &&
  report.cvType === 'application/pdf' &&
  report.cvSize === 'A. Candidate'.length &&
  report.seen.includes('cv-change') &&
  report.drag.ok === true &&
  report.cardInBin === true &&
  report.seen.includes('card-dragstart') &&
  report.seen.includes('bin-drop') &&
  report.selectorWait.ok === true &&
  report.textWait.ok === true &&
  report.quietWait.ok === true &&
  report.missingWait.ok === false &&
  report.badWait.ok === false

await browser.close()
console.log(ok ? 'INTERACTION CHECK: PASS' : 'INTERACTION CHECK: FAIL')
process.exit(ok ? 0 : 1)
