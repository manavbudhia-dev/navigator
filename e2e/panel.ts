import { expect, type Page } from '@playwright/test'

import { MOCK_BASE } from './env'

/**
 * Panel helpers. Everything here clicks the same buttons a person clicks; the
 * one exception is `startTaskOnTab`, explained in its own comment.
 */

export const FORM_URL = `${MOCK_BASE}/form.html`

export async function openSection(panel: Page, name: 'Agent' | 'Research' | 'Tabs' | 'Profiles' | 'History'): Promise<void> {
  await panel.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click()
}

/** Points the model at the local script so the run needs no API key. */
export async function useMockModel(panel: Page): Promise<void> {
  await panel.getByRole('button', { name: 'Settings' }).click()
  await panel.getByLabel('Base URL').fill(`${MOCK_BASE}/v1`)
  await panel.getByLabel('API key').fill('')
  await panel.getByLabel('Model (agent)').fill('e2e-model')
  await panel.getByLabel('Small model (fast tasks)').fill('e2e-small')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Saved' })).toBeVisible()
}

/** Creates the vault and one profile, through the Profiles tab. */
export async function createVaultAndProfile(panel: Page): Promise<void> {
  const passphrase = 'e2e-vault-passphrase'
  await openSection(panel, 'Profiles')
  await panel.getByLabel('Choose a passphrase').fill(passphrase)
  await panel.getByLabel('Repeat it').fill(passphrase)
  await panel.getByRole('button', { name: 'Create vault' }).click()
  await expect(panel.getByText('UNLOCKED')).toBeVisible()

  await panel.getByPlaceholder('e.g. Personal / Acme job search').fill('E2E personal')
  await panel.getByRole('button', { name: 'Create profile' }).click()
  await panel.getByLabel('First name').fill('Ada')
  await panel.getByLabel('Last name').fill('Lovelace')
  await panel.getByLabel('Email').fill('ada@example.com')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(panel.getByText('Encrypted')).toBeVisible()
  await panel.getByRole('button', { name: 'Back' }).click()
}

export type Mode = 'Observe' | 'Co-pilot' | 'Auto'

export async function setMode(panel: Page, mode: Mode): Promise<void> {
  await panel.getByRole('button', { name: /Observe|Co-pilot|Auto/ }).first().click()
  await panel.getByRole('listbox', { name: 'Execution mode' }).getByRole('option', { name: new RegExp(`^${mode}`) }).click()
}

/**
 * Starts the agent task against a chosen tab.
 *
 * Chrome's side panel is not a tab, so Playwright has to open the panel page in
 * one, and the worker then resolves "the active tab in the last focused window"
 * to the panel itself. This moves focus to the tab under test and clicks the
 * real Run button from inside the panel page, so the message, the loop and the
 * tools all run exactly as they do for a person.
 */
export async function startTaskOnTab(panel: Page, url: string): Promise<void> {
  await panel.evaluate(async (targetUrl: string) => {
    const [tab] = await chrome.tabs.query({ url: targetUrl })
    if (tab?.id === undefined || tab.windowId === undefined) throw new Error(`No tab open at ${targetUrl}`)
    await chrome.windows.update(tab.windowId, { focused: true })
    await chrome.tabs.update(tab.id, { active: true })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Send task"]')
    if (button === null) throw new Error('The panel has no Send task button')
    button.click()
  }, url)
}

/**
 * The panel swaps its Run button for Stop while a task runs, so the button
 * coming back means the loop ended. Returns the timeline text for assertions.
 */
export async function waitForTaskFinish(panel: Page): Promise<string> {
  await expect(panel.getByRole('button', { name: 'Run task' })).toBeVisible({ timeout: 120_000 })
  return await panel.getByRole('list').last().innerText()
}
