import { MODE_DESCRIPTIONS, MODE_LABELS, AGENT_MODES, type AgentMode } from '@/types/agent'
import { themeCommandLabel, type Theme } from '@/lib/theme'
import { VIEWS, type ViewId } from './views'
import type { CommandGroup, Command, RunnableCommand } from '@/commands/model'

/**
 * What the command palette offers (spec §10). A plain function of the panel's
 * state, so the list is unit-testable and a command that cannot run right now
 * is still on the list — greyed, with the reason — rather than silently
 * missing.
 */

export interface PanelControls {
  go: (view: ViewId) => void
  goal: string
  mode: AgentMode
  running: boolean
  /** False when the panel is not running inside Chrome. */
  inChrome: boolean
  startWrittenTask: () => void
  stopTask: () => void
  focusTaskBox: () => void
  setMode: (mode: AgentMode) => void
  theme: Theme
  toggleTheme: () => void
  overlayOn: boolean
  toggleOverlay: () => void
  exportAuditLog: () => void
}

const VIEW_KEYWORDS: Record<ViewId, string[]> = {
  agent: ['task', 'run', 'home'],
  research: ['question', 'sources', 'citations'],
  tabs: ['groups', 'close', 'session'],
  profiles: ['vault', 'passwords', 'fill', 'identity'],
  history: ['audit', 'log', 'recipes', 'memory', 'cost'],
  settings: ['model', 'api key', 'allowlist', 'appearance'],
}

function modeShort(mode: AgentMode): string {
  return MODE_LABELS[mode].split(' (')[0] ?? mode
}

export function buildCommands(controls: PanelControls): RunnableCommand[] {
  const written = controls.goal.trim()
  const task: RunnableCommand[] = [
    {
      id: 'task.run-written',
      title: 'Run the task you wrote',
      group: 'Task',
      keywords: ['start', 'go', 'send'],
      ...(written === '' ? {} : { hint: `“${written.slice(0, 48)}”` }),
      disabled: written === '' || controls.running,
      reason: written === '' ? 'Write a task in the Agent tab first, or type it here.' : 'A task is already running.',
      run: controls.startWrittenTask,
    },
    {
      id: 'task.stop',
      title: 'Stop the running task',
      group: 'Task',
      keywords: ['kill', 'abort', 'cancel', 'esc'],
      disabled: !controls.running,
      reason: 'Nothing is running.',
      run: controls.stopTask,
    },
    {
      id: 'task.write-new',
      title: 'Write a new task',
      group: 'Task',
      keywords: ['agent', 'input', 'focus'],
      hint: 'puts the cursor in the task box',
      run: () => {
        controls.go('agent')
        controls.focusTaskBox()
      },
    },
  ]

  const modes: RunnableCommand[] = AGENT_MODES.map((value) => ({
    id: `mode.${value}`,
    title: `Switch to ${modeShort(value)} mode`,
    group: 'Mode',
    keywords: ['autonomy', 'approval', value],
    hint: MODE_DESCRIPTIONS[value],
    disabled: controls.mode === value,
    reason: 'That is the current mode.',
    run: () => controls.setMode(value),
  }))

  const go: RunnableCommand[] = VIEWS.map((view) => ({
    id: `go.${view.id}`,
    title: `Go to ${view.label}`,
    group: 'Go to',
    keywords: VIEW_KEYWORDS[view.id],
    hint: view.hint,
    disabled: false,
    run: () => controls.go(view.id),
  }))

  const view: RunnableCommand[] = [
    {
      id: 'view.theme',
      title: themeCommandLabel(controls.theme),
      group: 'View',
      keywords: ['dark', 'light', 'theme', 'appearance'],
      hint: 'kept between panel opens',
      run: controls.toggleTheme,
    },
    {
      id: 'view.overlay',
      title: controls.overlayOn ? 'Hide the element map on the page' : 'Show the element map on the page',
      group: 'View',
      keywords: ['overlay', 'numbers', 'elements', 'highlight'],
      hint: 'numbers everything the agent can act on',
      disabled: !controls.inChrome,
      reason: 'Needs a real Chrome tab.',
      run: controls.toggleOverlay,
    },
  ]

  const data: RunnableCommand[] = [
    {
      id: 'data.export-audit',
      title: 'Export the audit log as JSON',
      group: 'Data',
      keywords: ['history', 'download', 'evidence', 'share'],
      hint: 'every step, decision and screenshot reference',
      disabled: !controls.inChrome,
      reason: 'Needs a real Chrome tab.',
      run: controls.exportAuditLog,
    },
  ]

  return [...task, ...modes, ...go, ...view, ...data]
}
