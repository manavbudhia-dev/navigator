import { expect, test } from './browser'
import {
  FORM_URL,
  openSection,
  setMode,
  startTaskOnTab,
  useMockModel,
  waitForTaskFinish,
} from './panel'

/**
 * Spec §9 with the blocked list: a site you close is shut for reads as well as
 * writes, in every mode, and there is no approval to click past it. The flow
 * starts from the one click that writes the rule, because a list nobody can
 * fill is a list that will not be honoured.
 */
test('a blocked site stops the read before the write, and asks nothing', async ({
  context,
  panel,
}) => {
  const page = await context.newPage()
  await page.goto(FORM_URL, { waitUntil: 'load' })

  await useMockModel(panel)

  await openSection(panel, 'Agent')
  await panel.getByLabel('Task description').fill('Fill the job application form on this page')
  await setMode(panel, 'Auto')
  await startTaskOnTab(panel, FORM_URL)

  // The card is up because the site is not allowed — and it offers to close it.
  await expect(panel.getByText(/^Approve:/)).toBeVisible({ timeout: 60_000 })
  await panel.getByRole('button', { name: /Never act on 127\.0\.0\.1/i }).click()
  await expect(panel.locator('[data-site-blocked="127.0.0.1"]')).toBeVisible()

  // A rule is not an approval, so this task still needs its answer.
  await panel.getByRole('button', { name: 'Deny' }).click()
  await waitForTaskFinish(panel)

  // The next task is the one the rule was written for: stopped at the read.
  await startTaskOnTab(panel, FORM_URL)
  await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
  const timeline = await waitForTaskFinish(panel)
  expect(timeline).toMatch(/blocked list/i)
  await expect(panel.getByText(/^Approve:/)).toHaveCount(0)

  // Nothing was touched, and the task could still finish and say why.
  await page.bringToFront()
  await expect(page.locator('#first')).toHaveValue('')
})
