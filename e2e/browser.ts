import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test'

import { ARTICLE_DOMAIN, CHROME_OVERRIDE, EXTENSION_PATH, MOCK_BASE, MOCK_PORT } from './env'

/**
 * Playwright fixtures for running the built extension in the machine's own
 * Chrome. Each test gets a throw-away profile, so the vault, the settings and
 * the audit log never leak from one flow into the next.
 */

const PANEL_PATH = 'src/sidepanel/index.html'

interface NavFixtures {
  context: BrowserContext
  extensionId: string
  worker: Worker
  panel: Page
}

function profileDir(name: string): string {
  const dir = path.join(
    os.tmpdir(),
    'navigator-e2e',
    `${name.replace(/[^a-z0-9]+/gi, '-')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  )
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function waitForWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0]
  if (existing !== undefined) return existing
  return await context.waitForEvent('serviceworker', { timeout: 30_000 })
}

export const test = base.extend<NavFixtures>({
  // Each test owns its browser: an unpacked extension needs a persistent profile.
  context: async ({}, use, testInfo) => {
    const dir = profileDir(testInfo.title)
    const context = await chromium.launchPersistentContext(dir, {
      // The full Chrome-for-Testing binary, not the headless shell: only the
      // former keeps an unpacked extension and its service worker alive.
      channel: 'chromium',
      headless: process.env['NAV_E2E_HEADED'] !== '1',
      ...(CHROME_OVERRIDE === undefined ? {} : { executablePath: CHROME_OVERRIDE }),
      viewport: { width: 480, height: 900 },
      // Playwright turns extensions off by default; the whole point here is one.
      ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
      args: [
        '--enable-extensions',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-background-timer-throttling',
        // The fixture corpus pretends to be five different publications.
        `--host-resolver-rules=MAP *.${ARTICLE_DOMAIN} 127.0.0.1:${MOCK_PORT}`,
      ],
    })
    try {
      await use(context)
    } finally {
      await context.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  },

  extensionId: async ({ context }, use) => {
    const worker = await waitForWorker(context)
    await use(new URL(worker.url()).host)
  },

  worker: async ({ context }, use) => {
    await use(await waitForWorker(context))
  },

  panel: async ({ context, extensionId }, use) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/${PANEL_PATH}`, { waitUntil: 'load' })
    await page.getByRole('navigation', { name: 'Sections' }).waitFor()
    await use(page)
    await page.close()
  },
})

export { expect, MOCK_BASE }

/**
 * The results page is fetched on `localhost` while the articles it links to
 * live on `127.0.0.1`. The engine drops a result that points back at the
 * search engine's own host, so the two have to look like different sites.
 */
export const SERP_BASE = `http://localhost:${MOCK_PORT}`

/** Clicks a tab in the panel's section rail. */
export async function openSection(panel: Page, name: string): Promise<void> {
  await panel.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name }).first().click()
}

/**
 * Serves the fixture corpus as the search engine's results page. The engine
 * really opens a background tab, really waits for it and really scrapes it, so
 * the ranking, the per-domain cap and the noise filters all run.
 *
 * The rewrite happens inside the service worker rather than with
 * `context.route()`: Playwright only intercepts navigations of pages it owns,
 * and the research engine creates its tabs from the extension itself.
 */
export async function stubSearchEngine(worker: Worker): Promise<void> {
  await worker.evaluate(([serpBase]) => {
    const namespace = chrome.tabs as unknown as {
      create(options: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>
    }
    const create = namespace.create.bind(namespace)
    namespace.create = (options) => {
      const target = options.url
      const url =
        typeof target === 'string' && target.startsWith('https://duckduckgo.com/html/')
          ? `${serpBase}/serp?q=${encodeURIComponent(new URL(target).searchParams.get('q') ?? '')}`
          : target
      return create(url === undefined ? options : { ...options, url })
    }
  }, [SERP_BASE])
}
