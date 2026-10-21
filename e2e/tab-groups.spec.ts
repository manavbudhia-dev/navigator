import { expect, test } from './browser'

import { MOCK_BASE } from './env'
import { openSection } from './panel'

/**
 * Spec §13.6 flow 3: tab grouping. The sentence is read by the rules first, so
 * no model is configured or called; Chrome itself ends up holding the groups.
 */
test('groups the open tabs when asked in plain language', async ({ context, panel, worker }) => {
  const urls = [
    `${MOCK_BASE}/sources/metering?visit=1`,
    `${MOCK_BASE}/sources/metering?visit=2`,
    `${MOCK_BASE}/sources/utility?visit=1`,
    `${MOCK_BASE}/sources/contractor?visit=1`,
  ]
  for (const url of urls) {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'load' })
  }

  await openSection(panel, 'Tabs')
  await panel.getByLabel('Tab command').fill('group my tabs')
  await panel.getByLabel('Tab command').press('Enter')

  const report = panel.locator('[data-report]')
  await expect(report).toBeVisible({ timeout: 30_000 })
  await expect(report).toContainText(/grouped \d+ tabs as/)

  // The proof is in Chrome, not in the panel's own summary.
  const state = await worker.evaluate(async () => {
    const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})])
    const grouped = tabs.filter((tab) => tab.groupId > 0)
    return {
      groups: groups.map((group) => ({
        title: group.title ?? '',
        tabs: tabs.filter((tab) => tab.groupId === group.id).length,
      })),
      grouped: grouped.length,
    }
  })

  expect(state.groups.length).toBeGreaterThanOrEqual(1)
  expect(state.groups.some((group) => group.tabs >= 2)).toBe(true)
  expect(state.grouped).toBeGreaterThanOrEqual(2)
})
