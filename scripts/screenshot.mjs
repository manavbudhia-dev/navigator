import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const url = process.argv[2] ?? 'http://localhost:5173/src/sidepanel/index.html'
const width = Number(process.argv[3] ?? 420)
const height = Number(process.argv[4] ?? 940)
const out = join(tmpdir(), 'navigator-sidepanel.png')

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--force-device-scale-factor=1'],
})

const page = await browser.newPage()
await page.setViewport({ width, height })
await page.goto(url, { waitUntil: 'networkidle0' })
await new Promise((resolve) => setTimeout(resolve, 500))
await page.screenshot({ path: out })
await browser.close()

console.log(out)
