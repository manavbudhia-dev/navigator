import { inExtension } from './extension'

/**
 * Dark mode (spec §10). Two files because the rules are cheap to test and the
 * storage is not: `theme.ts` decides, `themeStore.ts` remembers.
 */
export type Theme = 'light' | 'dark'

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}

/** A minimal surface so the caller can be the document or a test double. */
export interface ThemeRoot {
  classList: { toggle: (name: string, force: boolean) => void }
}

/** The `.dark` class in globals.css hangs off `<html>`, so the panel flips at once. */
export function applyTheme(theme: Theme, root: ThemeRoot = document.documentElement): void {
  root.classList.toggle('dark', theme === 'dark')
}

export function themeLabel(theme: Theme): string {
  return theme === 'dark' ? 'Dark mode' : 'Light mode'
}

/** What the palette offers: the mode you would get, not the one you are in. */
export function themeCommandLabel(theme: Theme): string {
  return `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`
}

/**
 * The theme to show before storage answers. Inside the extension the default
 * stays light — that is the design the panel was built against — while a plain
 * browser tab (the dev server, the headless checks) follows the OS.
 */
export function preferredTheme(matchesDark: boolean, inChromeExtension = inExtension): Theme {
  return !inChromeExtension && matchesDark ? 'dark' : 'light'
}
