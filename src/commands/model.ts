/**
 * The command palette's model (spec §10). Everything here is pure — the
 * matcher, the grouping and the shortcut test have no DOM — so the palette
 * component is only a list box and the interesting part is unit-testable.
 */

export type CommandGroup = 'Task' | 'Mode' | 'Safety' | 'Go to' | 'View' | 'Data'

/** The order groups appear in, whatever order the commands were declared in. */
export const GROUP_ORDER: readonly CommandGroup[] = ['Task', 'Mode', 'Safety', 'Go to', 'View', 'Data']

export interface Command {
  id: string
  title: string
  group: CommandGroup
  /** Extra words that name the same thing: "dark theme" finds "Toggle dark mode". */
  keywords?: readonly string[]
  /** Right-aligned detail, usually the consequence or the current value. */
  hint?: string
  disabled?: boolean
  /** Shown instead of running the command, so a greyed row explains itself. */
  reason?: string
}

/** A command the palette can actually fire. */
export interface RunnableCommand extends Command {
  run: () => void
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}._-]*/gu

export function commandTerms(text: string): string[] {
  const out: string[] = []
  for (const match of text.toLowerCase().matchAll(WORD)) {
    const word = match[0]!
    if (!out.includes(word)) out.push(word)
  }
  return out
}

/** 2 for a word typed in full, 1 for a prefix or an inside match, 0 for nothing. */
function fieldScore(term: string, words: readonly string[]): number {
  let best = 0
  for (const word of words) {
    if (word === term) return 2
    if (best < 1 && (word.startsWith(term) || word.includes(term) || term.startsWith(word))) best = 1
  }
  return best
}

/**
 * Title matches count most, then the aliases the command carries, then its
 * group. Matching every word you typed beats matching one of them loudly, and
 * a title that starts with the whole phrase wins outright.
 */
export function scoreCommand(query: string, command: Command): number {
  const terms = commandTerms(query)
  if (terms.length === 0) return 0
  const title = commandTerms(command.title)
  const keys = (command.keywords ?? []).flatMap((keyword) => commandTerms(keyword))
  const group = commandTerms(command.group)
  let hits = 0
  let score = 0
  for (const term of terms) {
    const inTitle = fieldScore(term, title)
    const inKey = fieldScore(term, keys)
    const inGroup = fieldScore(term, group)
    if (inTitle + inKey + inGroup === 0) continue
    hits += 1
    score += inTitle * 3 + (inKey > 0 ? 2 : 0) + (inGroup > 0 ? 1 : 0)
  }
  if (hits === 0) return 0
  const phrase = command.title.toLowerCase().startsWith(query.trim().toLowerCase())
  return score * (hits / terms.length) + (phrase ? 8 : 0)
}

/** Best match first; ties keep the order the commands were declared in. */
export function filterCommands<T extends Command>(query: string, commands: readonly T[]): T[] {
  if (query.trim() === '') return [...commands]
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(query, command) }))
    .filter((matched) => matched.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((matched) => matched.command)
}

/** Matched commands bucketed by group, groups in GROUP_ORDER, empty ones dropped. */
export function groupCommands<T extends Command>(
  commands: readonly T[],
): { group: CommandGroup; items: T[] }[] {
  const buckets = new Map<CommandGroup, T[]>()
  for (const command of commands) {
    const bucket = buckets.get(command.group)
    if (bucket === undefined) buckets.set(command.group, [command])
    else bucket.push(command)
  }
  return GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    items: buckets.get(group)!,
  }))
}

export const PALETTE_SHORTCUT_LABEL = 'Ctrl+Shift+K'

/**
 * Ctrl+Shift+K on Windows, Linux and ChromeOS, Command+Shift+K on a Mac. The
 * physical `code` is checked too because a non-Latin keyboard layout reports a
 * different `key` for the same finger position.
 */
export function isPaletteShortcut(event: {
  key?: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}): boolean {
  const letter = event.code === 'KeyK' || (event.key ?? '').toLowerCase() === 'k'
  return letter && event.shiftKey === true && (event.ctrlKey === true || event.metaKey === true)
}

/** The flat list the palette walks with the arrow keys, skipping greyed rows. */
export function selectableIndexes(items: readonly Command[]): number[] {
  const out: number[] = []
  items.forEach((item, index) => {
    if (item.disabled !== true) out.push(index)
  })
  return out
}

/** Next selectable row after `from`, wrapping around the list. */
export function nextIndex(items: readonly Command[], from: number, step: number): number {
  const usable = selectableIndexes(items)
  if (usable.length === 0) return 0
  if (!usable.includes(from)) {
    return step > 0 ? usable[0]! : usable[usable.length - 1]!
  }
  const at = usable.indexOf(from)
  const next = (at + (step > 0 ? 1 : usable.length - 1)) % usable.length
  return usable[next]!
}
