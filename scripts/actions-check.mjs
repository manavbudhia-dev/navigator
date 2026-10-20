import { existsSync } from 'node:fs'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })
await page.goto('http://localhost:5173/fixtures/perception.html', { waitUntil: 'networkidle0' })

// Vite appends ?t=... to rewritten imports; importing the bare path would
// give a SECOND module instance with its own empty snapshot. Use the exact
// specifier actions.ts itself receives.
const actionsSrc = await (await fetch('http://localhost:5173/src/content/actions.ts')).text()
const pageStateUrl = actionsSrc.match(/from "([^"]*perception\/pageState\.ts[^"]*)"/)?.[1]
if (!pageStateUrl) throw new Error('Could not find pageState import in transformed actions.ts')

const report = await page.evaluate(async (psUrl) => {
  const { buildPageState, getSnapshot } = await import(psUrl)
  const { performAct } = await import('/src/content/actions.ts')

  const log = []
  const email = document.getElementById('email')
  email.addEventListener('input', () => log.push(`input:${email.value}`))
  email.addEventListener('change', () => log.push('change'))
  const pointer = document.getElementById('pointer')
  pointer.addEventListener('click', () => log.push('pointer-clicked'))
  const select = document.getElementById('country')
  select.addEventListener('change', () => log.push(`select:${select.value}`))

  buildPageState(document, { includeOffViewport: true, maxElements: 400, tokenBudget: 4000 })
  const snapshot = getSnapshot()
  const indexOf = (pred) => snapshot.find(pred)?.index ?? -1

  const idxPointer = indexOf((el) => el.tag === 'span' && el.text.includes('Looks clickable'))
  const idxEmail = indexOf((el) => el.attributes['id'] === 'email')
  const idxCountry = indexOf((el) => el.tag === 'select')
  const idxFar = indexOf((el) => el.attributes['id'] === 'far')

  const results = {
    clickPointer: performAct({ type: 'click', index: idxPointer }),
    typeEmail: performAct({ type: 'type', index: idxEmail, text: 'agent@example.com' }),
    selectCountry: performAct({ type: 'type', index: idxCountry, text: 'Germany' }),
    scrollDown: performAct({ type: 'scroll', direction: 'down', amount: 0.5 }),
    clickStale: performAct({ type: 'click', index: 999 }),
    clickOffViewport: performAct({ type: 'click', index: idxFar }),
  }

  return {
    results,
    log,
    emailValue: email.value,
    selectValue: select.value,
    scrollY: window.scrollY,
  }
}, pageStateUrl)

console.log(JSON.stringify(report, null, 2))

const ok =
  report.results.clickPointer.ok === true &&
  report.log.includes('pointer-clicked') &&
  report.results.typeEmail.ok === true &&
  report.emailValue === 'agent@example.com' &&
  report.log.some((line) => line.startsWith('input:')) &&
  report.results.selectCountry.ok === true &&
  report.selectValue === 'Germany' &&
  report.results.scrollDown.ok === true &&
  report.scrollY > 0 &&
  report.results.clickStale.ok === false &&
  report.results.clickOffViewport.ok === true

await browser.close()
console.log(ok ? 'ACTIONS CHECK: PASS' : 'ACTIONS CHECK: FAIL')
process.exit(ok ? 0 : 1)
