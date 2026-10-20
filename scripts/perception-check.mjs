import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1024, height: 768 })
await page.goto('http://localhost:5173/fixtures/perception.html', { waitUntil: 'networkidle0' })

const summary = await page.evaluate(async () => {
  const host = document.getElementById('shadow-host')
  const shadow = host.attachShadow({ mode: 'open' })
  const inner = document.createElement('button')
  inner.textContent = 'Shadow action'
  shadow.appendChild(inner)

  const module = await import('/src/content/perception/pageState.ts')
  const state = module.buildPageState(document, {
    includeOffViewport: true,
    maxElements: 400,
    tokenBudget: 4000,
  })
  return {
    elementCount: state.elementCount,
    inViewportCount: state.inViewportCount,
    tokenEstimate: state.tokenEstimate,
    lines: state.elementLines,
    markdownHead: state.markdown.slice(0, 220),
    truncatedElements: state.truncatedElements,
    truncatedMarkdown: state.truncatedMarkdown,
  }
})

await browser.close()
console.log(JSON.stringify(summary, null, 2))
