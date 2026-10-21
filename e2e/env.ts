import path from 'node:path'

/**
 * The E2E run needs a Chromium that honours `--load-extension`. Google removed
 * that flag from ordinary desktop Chrome in v137, so the suite uses the Chrome
 * for Testing binary Playwright downloads (`playwright install chromium`) and
 * never the user's own browser.
 */
export const EXTENSION_PATH = path.resolve('dist')

/** Set NAV_CHROME to point the suite at a different Chromium build. */
export const CHROME_OVERRIDE = process.env['NAV_CHROME']

/** The local server that plays the search engine, the article sites and the model. */
export const MOCK_PORT = Number(process.env['NAV_E2E_PORT'] ?? 8731)
export const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`

/**
 * The fixture articles are served on `metering.heatpump.test` and friends.
 * Real-sounding hosts matter because the research engine keeps at most two
 * pages per domain — one host could never produce five sources. The E2E
 * browser maps the whole domain onto the local mock (see e2e/browser.ts).
 */
export const ARTICLE_DOMAIN = 'heatpump.test'
