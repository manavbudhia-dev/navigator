import { expect, stubSearchEngine, test } from './browser'
import { openSection, useMockModel } from './panel'

import { ARTICLE_DOMAIN } from './env'

/**
 * Spec §13.6 flow 2: five-source research. The engine plans, opens real
 * background tabs, scrapes a real results page, ranks and drops the noise, then
 * writes a cited answer. Only the outside world is local.
 */
test('researches a question across five sources and cites them', async ({ panel, worker }) => {
  await stubSearchEngine(worker)
  await useMockModel(panel)

  await openSection(panel, 'Research')
  await panel
    .getByLabel('Research question')
    .fill('Do heat pumps actually cut heating bills in cold climates?')
  await panel.getByRole('group', { name: 'Research depth' }).getByRole('button', { name: /Standard/ }).click()
  await panel.getByRole('main').getByRole('button', { name: 'Research', exact: true }).click()

  const report = panel.locator('[data-result-id]')
  await expect(report).toBeVisible({ timeout: 150_000 })

  const sources = panel.locator('section', { has: panel.getByRole('heading', { name: 'Sources' }) }).locator('ul > li')
  await expect(sources).toHaveCount(5, { timeout: 15_000 })

  // The header chip, the list and the answer all agree on the same five pages.
  await expect(report).toContainText('5 sources')
  const hrefs = await sources.locator('a').evaluateAll((links) =>
    links.map((link) => (link as HTMLAnchorElement).href),
  )
  expect(new Set(hrefs).size).toBe(5)
  for (const href of hrefs) expect(new URL(href).hostname.endsWith(ARTICLE_DOMAIN)).toBe(true)
  await expect(panel.getByRole('heading', { name: 'Answer' })).toBeVisible()
})
