/**
 * The panel's sections, named once so the tab bar, the palette and the
 * keyboard shortcuts all call them the same thing.
 */
export type ViewId = 'agent' | 'research' | 'tabs' | 'profiles' | 'history' | 'settings'

export interface ViewMeta {
  id: ViewId
  label: string
  hint: string
}

export const VIEWS: readonly ViewMeta[] = [
  { id: 'agent', label: 'Agent', hint: 'Give the agent a task and watch its steps' },
  { id: 'research', label: 'Research', hint: 'Ask a question, get a cited answer' },
  { id: 'tabs', label: 'Tabs', hint: 'Close, group, find and save tabs' },
  { id: 'profiles', label: 'Profiles', hint: 'The encrypted vault the form filler reads' },
  { id: 'history', label: 'History', hint: 'Runs, recipes and what Navigator remembers' },
  { id: 'settings', label: 'Settings', hint: 'Model, keys, modes and safety lists' },
]

export const TAB_VIEWS: readonly ViewMeta[] = VIEWS.filter((view) => view.id !== 'settings')

export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && VIEWS.some((view) => view.id === value)
}
