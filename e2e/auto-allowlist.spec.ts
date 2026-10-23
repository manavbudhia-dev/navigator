import { expect, test } from './browser'
import {
  FORM_URL,
  createVaultAndProfile,
  openSection,
  setMode,
  startTaskOnTab,
  useMockModel,
  waitForTaskFinish,
} from './panel'

/**
 * Spec §9 with the site list: Auto mode means "acts alone on allowlisted
 * sites", so the flow is the promise in both halves — a task that stops to ask
 * on a site nobody allowed, the one click that allows it, and a second task that
 * runs the same page without asking at all.
 */
test('Auto mode asks on a site until you allow it, then works alone there', async ({
  context,
  panel,
}) => {
  const page = await context.newPage()
  await page.goto(FORM_URL, { waitUntil: 'load' })

  await useMockModel(panel)
  await createVaultAndProfile(panel)

  await openSection(panel, 'Agent')
  await panel.getByLabel('Task description').fill('Fill the job application form on this page')
  await setMode(panel, 'Auto')
  await startTaskOnTab(panel, FORM_URL)

  // The card is up because of the site, and it says so.
  await expect(panel.getByText(/^Approve:/)).toBeVisible({ timeout: 60_000 })
  await expect(panel.getByText(/you have not allowed/i)).toBeVisible()

  // One click turns the page it is standing on into a rule.
  await panel.getByRole('button', { name: /Allow 127\.0\.0\.1 in Auto mode/i }).click()
  await expect(panel.locator('[data-site-allowed="127.0.0.1"]')).toBeVisible()

  // The current task still needs its answer: a rule is not an approval.
  await panel.getByRole('button', { name: 'Allow once' }).click()
  await waitForTaskFinish(panel)

  await page.bringToFront()
  await expect(page.locator('#first')).toHaveValue('Ada')
  await expect(page.locator('#terms')).not.toBeChecked()

  // The next task on the same site is the one the rule was written for.
  await startTaskOnTab(panel, FORM_URL)
  await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
  const timeline = await waitForTaskFinish(panel)
  expect(timeline).toMatch(/fill_form/i)
  await expect(panel.getByText(/^Approve:/)).toHaveCount(0)
})
