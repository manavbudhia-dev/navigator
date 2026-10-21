import { defineConfig } from '@playwright/test'

import { MOCK_BASE } from './e2e/env'

/**
 * End-to-end batch of spec §13.6. These run the built `dist/` extension inside
 * the machine's own Chrome, so Chrome APIs, content scripts and IndexedDB are
 * real. The outside world is replaced by `e2e/mock-server.mjs`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // One browser profile at a time: the agent owns the active tab and Chrome
  // gives each worker its own window, so parallel runs fight over focus.
  workers: 1,
  reporter: [['list']],
  outputDir: 'node_modules/.tmp/playwright',
  webServer: {
    command: 'node e2e/mock-server.mjs',
    url: `${MOCK_BASE}/health`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
