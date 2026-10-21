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
 * Spec §13.6 flow 1: form fill. A person asks for the job form to be filled,
 * approves the one write action, and Navigator types the vault values into the
 * fields it is allowed to touch.
 */
test('fills a job application from the vault and leaves the protected fields alone', async ({
  context,
  panel,
}) => {
  const page = await context.newPage()
  await page.goto(FORM_URL, { waitUntil: 'load' })

  await useMockModel(panel)
  await createVaultAndProfile(panel)

  await openSection(panel, 'Agent')
  await panel.getByLabel('Task description').fill('Fill the job application form on this page')
  await setMode(panel, 'Co-pilot')
  await startTaskOnTab(panel, FORM_URL)

  // The write action waits for a human: copilot asks, the test says yes once.
  await expect(panel.getByText(/^Approve:/)).toBeVisible({ timeout: 60_000 })
  await panel.getByRole('button', { name: 'Allow once' }).click()

  await waitForTaskFinish(panel)

  await page.bringToFront()
  await expect(page.locator('#first')).toHaveValue('Ada')
  await expect(page.locator('#last')).toHaveValue('Lovelace')
  await expect(page.locator('#mail')).toHaveValue('ada@example.com')

  // Never filled, never ticked, and the form is still on the page.
  await expect(page.locator('#card')).toHaveValue('')
  await expect(page.locator('#otp')).toHaveValue('')
  await expect(page.locator('#pw')).toHaveValue('')
  await expect(page.locator('#cv')).toBeEmpty()
  await expect(page.locator('#terms')).not.toBeChecked()
  await expect(page.locator('#robot')).not.toBeChecked()
  expect(page.url()).toBe(FORM_URL)
})
