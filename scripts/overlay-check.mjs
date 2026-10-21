import { existsSync } from 'node:fs'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const OPTIONS = { includeOffViewport: true, maxElements: 400, tokenBudget: 4000 }

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })
await page.goto('http://localhost:5173/fixtures/perception.html', { waitUntil: 'networkidle0' })

// Same trick as actions-check: reuse the pageState module instance overlay.ts already has.
const overlaySrc = await (await fetch('http://localhost:5173/src/content/overlay.ts')).text()
const pageStateUrl = overlaySrc.match(/from "([^"]*perception\/pageState\.ts[^"]*)"/)?.[1]
if (!pageStateUrl) throw new Error('Could not find pageState import in transformed overlay.ts')

const report = await page.evaluate(async (psUrl, options) => {
  const { buildPageState, getSnapshot } = await import(psUrl)
  const { highlightElement, setOverlay } = await import('/src/content/overlay.ts')

  buildPageState(document, options)
  const snapshot = getSnapshot()
  const idxEmail = snapshot.find((el) => el.attributes['id'] === 'email')?.index ?? -1
  const idxFar = snapshot.find((el) => el.attributes['id'] === 'far')?.index ?? -1

  const on = setOverlay(true)
  const layer = document.getElementById('navigator-overlay')
  const boxes = Array.from(document.querySelectorAll('#navigator-overlay .nav-box')).map((box) => ({
    label: box.querySelector('.nav-tag')?.textContent,
    top: box.style.top,
  }))
  const pointerEvents = getComputedStyle(layer ?? document.body).pointerEvents
  const style = document.getElementById('navigator-overlay-style')?.textContent ?? ''

  const highlighted = highlightElement(idxEmail)
  const pulses = document.querySelectorAll('#navigator-overlay .nav-pulse').length
  await new Promise((resolve) => setTimeout(resolve, 1600))
  const pulsesAfter = document.querySelectorAll('#navigator-overlay .nav-pulse').length

  const stale = highlightElement(9999)
  const offscreen = highlightElement(idxFar)
  const off = setOverlay(false)

  return {
    on,
    boxes,
    pointerEvents,
    styleInjected: style.includes('nav-pulse'),
    highlighted,
    pulses,
    pulsesAfter,
    stale,
    offscreenDetail: offscreen.detail ?? offscreen.error,
    off,
    layerGone: document.getElementById('navigator-overlay') === null,
    snapshotSize: snapshot.length,
  }
}, pageStateUrl, OPTIONS)

console.log(JSON.stringify(report, null, 2))

await page.evaluate(async (psUrl, options) => {
  const { buildPageState } = await import(psUrl)
  const { setOverlay } = await import('/src/content/overlay.ts')
  window.scrollTo(0, 0)
  buildPageState(document, options)
  setOverlay(true)
}, pageStateUrl, OPTIONS)
await page.screenshot({ path: 'C:/Users/manav/AppData/Local/Temp/navigator-overlay.png' })

const ok =
  report.on.ok === true &&
  report.boxes.length >= 5 &&
  report.boxes.every((box) => typeof box.label === 'string') &&
  report.pointerEvents === 'none' &&
  report.styleInjected === true &&
  report.highlighted.ok === true &&
  report.pulses === 1 &&
  report.pulsesAfter === 0 &&
  report.stale.ok === false &&
  report.off.ok === true &&
  report.layerGone === true

await browser.close()
console.log(ok ? 'OVERLAY CHECK: PASS' : 'OVERLAY CHECK: FAIL')
process.exit(ok ? 0 : 1)
