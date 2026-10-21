import { describe, expect, it } from 'vitest'

import {
  filterCommands,
  groupCommands,
  isPaletteShortcut,
  nextIndex,
  scoreCommand,
  selectableIndexes,
  type Command,
} from './model'

/**
 * Batch 11c (spec §10): the palette's matcher. What it decides is which command
 * a typed word points at, and that has to be right before any of the UI does.
 */

function command(id: string, title: string, group: Command['group'], keywords?: string[]): Command {
  return { id, title, group, ...(keywords === undefined ? {} : { keywords }) }
}

const COMMANDS: Command[] = [
  command('task.run-written', 'Run the task you wrote', 'Task', ['start', 'go', 'send']),
  command('task.stop', 'Stop the running task', 'Task', ['kill', 'abort', 'cancel']),
  command('go.history', 'Go to History', 'Go to', ['audit', 'log', 'recipes', 'memory']),
  command('go.settings', 'Go to Settings', 'Go to', ['model', 'api key', 'allowlist']),
  command('view.theme', 'Switch to dark mode', 'View', ['dark', 'light', 'theme']),
  command('mode.auto', 'Switch to Auto mode', 'Mode', ['autonomy', 'approval', 'auto']),
]

describe('scoreCommand', () => {
  it('says nothing about an empty query', () => {
    expect(scoreCommand('', COMMANDS[0]!)).toBe(0)
    expect(scoreCommand('   ', COMMANDS[0]!)).toBe(0)
  })

  it('ignores a word that appears nowhere', () => {
    expect(scoreCommand('banana', COMMANDS[0]!)).toBe(0)
  })

  it('matches a prefix of a title word', () => {
    expect(scoreCommand('hist', COMMANDS[2]!)).toBeGreaterThan(0)
  })

  it('prefers the title over a keyword', () => {
    const byTitle = scoreCommand('theme', command('a', 'Change the theme', 'View'))
    const byKeyword = scoreCommand('theme', command('b', 'Switch to dark mode', 'View', ['theme']))
    expect(byTitle).toBeGreaterThan(byKeyword)
  })

  it('matches every typed word better than one of them', () => {
    const all = scoreCommand('stop running task', COMMANDS[1]!)
    const one = scoreCommand('stop banana running task', COMMANDS[1]!)
    expect(all).toBeGreaterThan(one)
  })

  it('rewards a title that begins with the whole phrase', () => {
    const starts = scoreCommand('stop', COMMANDS[1]!)
    const middle = scoreCommand('task', COMMANDS[1]!)
    expect(starts).toBeGreaterThan(middle)
  })
})

describe('filterCommands', () => {
  it('keeps the declared order when nothing was typed', () => {
    expect(filterCommands('', COMMANDS).map((item) => item.id)).toEqual(COMMANDS.map((item) => item.id))
  })

  it('puts the best match first', () => {
    expect(filterCommands('dark', COMMANDS)[0]?.id).toBe('view.theme')
    expect(filterCommands('abort', COMMANDS)[0]?.id).toBe('task.stop')
  })

  it('finds a section by any of its aliases', () => {
    const ids = filterCommands('audit', COMMANDS).map((item) => item.id)
    expect(ids).toContain('go.history')
  })

  it('drops what does not match at all', () => {
    expect(filterCommands('zzz', COMMANDS)).toEqual([])
  })

  it('is case insensitive', () => {
    expect(filterCommands('HISTORY', COMMANDS)[0]?.id).toBe('go.history')
  })
})

describe('groupCommands', () => {
  it('orders groups by the palette layout, not by the match order', () => {
    const grouped = groupCommands([
      command('g', 'Go to History', 'Go to'),
      command('v', 'Switch to dark mode', 'View'),
      command('m', 'Switch to Auto mode', 'Mode'),
      command('t', 'Stop the task', 'Task'),
    ])
    expect(grouped.map((entry) => entry.group)).toEqual(['Task', 'Mode', 'Go to', 'View'])
  })

  it('leaves out empty groups', () => {
    const only = command('t', 'Stop the task', 'Task')
    expect(groupCommands([only])).toEqual([{ group: 'Task', items: [only] }])
  })
})

describe('arrow-key walking', () => {
  const rows = [
    command('a', 'First', 'Task'),
    { ...command('b', 'Second', 'Task'), disabled: true },
    command('c', 'Third', 'Task'),
  ]

  it('skips the greyed row', () => {
    expect(selectableIndexes(rows)).toEqual([0, 2])
    expect(nextIndex(rows, 0, 1)).toBe(2)
    expect(nextIndex(rows, 2, 1)).toBe(0)
    expect(nextIndex(rows, 2, -1)).toBe(0)
  })

  it('lands on the first usable row when there is no current one', () => {
    expect(nextIndex(rows, -1, 1)).toBe(0)
    expect(nextIndex(rows, -1, -1)).toBe(2)
  })

  it('has nowhere to go in an empty list, and says so without crashing', () => {
    expect(nextIndex([], 0, 1)).toBe(0)
  })
})

describe('isPaletteShortcut', () => {
  it('wants Ctrl+Shift+K', () => {
    expect(isPaletteShortcut({ key: 'K', ctrlKey: true, shiftKey: true })).toBe(true)
  })

  it('accepts the Mac spelling', () => {
    expect(isPaletteShortcut({ key: 'k', metaKey: true, shiftKey: true })).toBe(true)
  })

  it('reads the key position, not the letter, on a non-Latin layout', () => {
    expect(isPaletteShortcut({ key: 'л', code: 'KeyK', ctrlKey: true, shiftKey: true })).toBe(true)
  })

  it('refuses the same letter without Shift', () => {
    expect(isPaletteShortcut({ key: 'K', ctrlKey: true })).toBe(false)
  })

  it('refuses a different letter with the modifiers', () => {
    expect(isPaletteShortcut({ key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true })).toBe(false)
  })

  it('refuses a bare key with nothing held', () => {
    expect(isPaletteShortcut({ key: 'k' })).toBe(false)
  })
})
