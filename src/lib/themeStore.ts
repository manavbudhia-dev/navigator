import { inExtension } from './extension'
import type { Theme } from './theme'

/**
 * Where the panel's look is kept. Chrome's `storage.local` is the real home —
 * it survives the panel closing, which a component's state cannot — and the
 * localStorage fallback exists so the headless checks, which load the panel
 * from the dev server with no extension runtime, exercise the same code path.
 */
const KEY = 'navigator-theme'

export async function loadTheme(fallback: Theme = 'light'): Promise<Theme> {
  try {
    if (inExtension) {
      const stored = (await chrome.storage.local.get(KEY)) as Record<string, unknown>
      const value = stored[KEY]
      return value === 'dark' || value === 'light' ? value : fallback
    }
    const value = window.localStorage.getItem(KEY)
    return value === 'dark' || value === 'light' ? value : fallback
  } catch {
    return fallback
  }
}

export async function saveTheme(theme: Theme): Promise<void> {
  try {
    if (inExtension) await chrome.storage.local.set({ [KEY]: theme })
    else window.localStorage.setItem(KEY, theme)
  } catch {
    // A panel that cannot persist its theme still shows it.
  }
}
