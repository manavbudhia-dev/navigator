import { describe, expect, it, vi } from 'vitest'

import { buildCommands, type PanelControls } from './commands'
import { filterCommands } from '@/commands/model'
import type { CommandGroup } from '@/commands/model'
import type { AgentMode } from '@/types/agent'
import type { Theme } from '@/lib/theme'
import type { ViewId } from './views'

/**
 * Batch 11c (spec §10): the list the palette shows. The interesting behaviour
 * is not the running, it is what is offered and what is greyed out with a
 * reason, given the state the panel is in.
 */

function controls(overrides: Partial<PanelControls> = {}): PanelControls {
  const base: PanelControls = {
    go: vi.fn<(view: ViewId) => void>(),
    goal: '',
    mode: 'copilot',
    running: false,
    inChrome: true,
    startWrittenTask: vi.fn<() => void>(),
    stopTask: vi.fn<() => void>(),
    focusTaskBox: vi.fn<() => void>(),
    setMode: vi.fn<(mode: AgentMode) => void>(),
    theme: 'light',
    toggleTheme: vi.fn<() => void>(),
    overlayOn: false,
    toggleOverlay: vi.fn<() => void>(),
    exportAuditLog: vi.fn<() => void>(),
  }
  return { ...base, ...overrides }
}

function find(id: string) {
  const command = buildCommands(controls()).find((entry) => entry.id === id)
  if (command === undefined) throw new Error(`No command ${id}`)
  return command
}

describe('buildCommands', () => {
  it('offers every group the palette lays out', () => {
    const groups = new Set(buildCommands(controls()).map((command) => command.group))
    const expected: CommandGroup[] = ['Task', 'Mode', 'Safety', 'Go to', 'View', 'Data']
    expect([...groups].sort()).toEqual([...expected].sort())
  })

  it('gives every command a unique id and a title', () => {
    const commands = buildCommands(controls())
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length)
    expect(commands.every((command) => command.title.trim().length > 3)).toBe(true)
  })

  it('greys out "run the task you wrote" until there is a task', () => {
    const empty = find('task.run-written')
    expect(empty.disabled).toBe(true)
    expect(empty.reason).toMatch(/Agent tab|type/i)

    const written = buildCommands(controls({ goal: '  book two seats  ' })).find((entry) => entry.id === 'task.run-written')
    expect(written?.disabled).toBe(false)
    expect(written?.hint).toContain('book two seats')
  })

  it('greys out stop when nothing is running, and run when something is', () => {
    expect(find('task.stop').disabled).toBe(true)
    const busy = buildCommands(controls({ running: true, goal: 'do the thing' }))
    expect(busy.find((entry) => entry.id === 'task.stop')?.disabled).toBe(false)
    expect(busy.find((entry) => entry.id === 'task.run-written')?.disabled).toBe(true)
    expect(busy.find((entry) => entry.id === 'task.run-written')?.reason).toMatch(/already running/i)
  })

  it('marks the mode you are already in', () => {
    const commands = buildCommands(controls({ mode: 'auto' }))
    expect(commands.find((entry) => entry.id === 'mode.auto')?.disabled).toBe(true)
    expect(commands.find((entry) => entry.id === 'mode.observe')?.disabled).toBe(false)
    expect(commands.find((entry) => entry.id === 'mode.observe')?.title).toBe('Switch to Observe mode')
  })

  it('names the mode you would get, not the one you have', () => {
    expect(find('view.theme').title).toBe('Switch to dark mode')
    expect(buildCommands(controls({ theme: 'dark' })).find((entry) => entry.id === 'view.theme')?.title).toBe(
      'Switch to light mode',
    )
  })

  it('refuses page-side commands outside Chrome', () => {
    const outside = buildCommands(controls({ inChrome: false }))
    expect(outside.find((entry) => entry.id === 'view.overlay')?.disabled).toBe(true)
    expect(outside.find((entry) => entry.id === 'data.export-audit')?.disabled).toBe(true)
  })

  it('offers to hide the element map when it is showing', () => {
    expect(buildCommands(controls({ overlayOn: true })).find((entry) => entry.id === 'view.overlay')?.title).toBe(
      'Hide the element map on the page',
    )
  })

  it('runs the command the user asked for', () => {
    const panel = controls()
    buildCommands(panel).find((entry) => entry.id === 'mode.observe')?.run()
    expect(panel.setMode).toHaveBeenCalledWith('observe')

    const focused = controls()
    buildCommands(focused).find((entry) => entry.id === 'task.write-new')?.run()
    expect(focused.go).toHaveBeenCalledWith('agent')
    expect(focused.focusTaskBox).toHaveBeenCalled()
  })

  it('lists one command per section, in the order the tabs are', () => {
    const go = buildCommands(controls()).filter((command) => command.group === 'Go to')
    expect(go.map((command) => command.title)).toEqual([
      'Go to Agent',
      'Go to Research',
      'Go to Tabs',
      'Go to Profiles',
      'Go to History',
      'Go to Settings',
    ])
  })

  it('finds History by the things that live in it', () => {
    const commands = buildCommands(controls())
    expect(filterCommands('recipes', commands)[0]?.id).toBe('go.history')
    expect(filterCommands('vault', commands)[0]?.id).toBe('go.profiles')
    expect(filterCommands('api key', commands)[0]?.id).toBe('go.settings')
  })

  it('finds "stop" before "switch to auto mode"', () => {
    const commands = buildCommands(controls())
    expect(filterCommands('stop', commands)[0]?.id).toBe('task.stop')
  })

  it('offers the Auto mode site list by name, and opens it', () => {
    const commands = buildCommands(controls())
    expect(filterCommands('allowlist', commands)[0]?.id).toBe('safety.auto-sites')
    expect(filterCommands('allow this site', commands)[0]?.id).toBe('safety.auto-sites')
    const panel = controls()
    buildCommands(panel).find((entry) => entry.id === 'safety.auto-sites')?.run()
    expect(panel.go).toHaveBeenCalledWith('settings')
  })
})
