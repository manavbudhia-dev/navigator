// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { applyTheme, nextTheme, preferredTheme, themeCommandLabel, themeLabel } from './theme'

/**
 * Batch 11c (spec §10): the panel's look, so that the palette's "switch to dark
 * mode" says the right thing and the class lands where globals.css can see it.
 */

describe('nextTheme', () => {
  it('flips both ways', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('light')
  })
})

describe('labels', () => {
  it('names the mode you are in, and offers the other one', () => {
    expect(themeLabel('dark')).toBe('Dark mode')
    expect(themeCommandLabel('dark')).toBe('Switch to light mode')
    expect(themeCommandLabel('light')).toBe('Switch to dark mode')
  })
})

describe('applyTheme', () => {
  it('toggles .dark on whatever element it is handed', () => {
    const toggled: [string, boolean][] = []
    const root = { classList: { toggle: (name: string, force: boolean) => toggled.push([name, force]) } }
    applyTheme('dark', root)
    applyTheme('light', root)
    expect(toggled).toEqual([
      ['dark', true],
      ['dark', false],
    ])
  })
})

describe('preferredTheme', () => {
  it('follows the system in a plain browser tab', () => {
    expect(preferredTheme(true, false)).toBe('dark')
    expect(preferredTheme(false, false)).toBe('light')
  })

  it('starts light inside the extension, where the stored choice arrives a moment later', () => {
    expect(preferredTheme(true, true)).toBe('light')
  })
})
