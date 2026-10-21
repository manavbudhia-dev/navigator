import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'

import { filterCommands, groupCommands, nextIndex, type Command, type RunnableCommand } from '@/commands/model'
import { cn } from '@/lib/utils'

/**
 * The command palette (spec §10): one keystroke, a list of what Navigator can
 * do right now, and the arrow keys. It is a list box, not a menu — focus stays
 * in the input and `aria-activedescendant` says which row is highlighted, so a
 * screen reader follows the selection without the tab key walking the panel.
 */

interface Props {
  open: boolean
  commands: RunnableCommand[]
  onClose: () => void
  /** When set, a query long enough also offers "start a task with this". */
  onStartTask?: (query: string) => void
  shortcutLabel: string
}

/** A few words is the point where a query stops being a search and becomes a goal. */
const MIN_TASK_QUERY = 6

function queryTitle(query: string): string {
  const flat = query.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat
}

function optionId(command: Pick<Command, 'id'>): string {
  return `palette-option-${command.id}`
}

export function CommandPalette({ open, commands, onClose, onStartTask, shortcutLabel }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<RunnableCommand[]>(() => {
    const matched = filterCommands(query, commands)
    const trimmed = query.trim()
    if (!open || onStartTask === undefined || trimmed.length < MIN_TASK_QUERY) return matched
    const wanted: RunnableCommand = {
      id: 'task.from-query',
      title: `Start task: “${queryTitle(trimmed)}”`,
      group: 'Task',
      hint: 'the agent takes it from here',
      keywords: ['goal', 'agent', 'do'],
      run: () => onStartTask(trimmed),
    }
    return [wanted, ...matched]
  }, [commands, onStartTask, query, open])

  const flat = useMemo(() => groupCommands(items).flatMap((group) => group.items), [items])

  // A new list means a new highlight: keep the same command if it is still there.
  useEffect(() => {
    setActive((current) => {
      const id = flat[current]?.id
      const kept = id === undefined ? -1 : flat.findIndex((item) => item.id === id)
      return kept >= 0 ? kept : nextIndex(flat, -1, 1)
    })
  }, [flat])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const previous = document.activeElement
    inputRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || flat[active] === undefined) return
    const node = listRef.current?.querySelector(`#${CSS.escape(optionId(flat[active]!))}`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active, flat, open])

  const groups = useMemo(() => groupCommands(items), [items])

  if (!open) return null

  const current = flat[active]

  function runCommand(command: RunnableCommand | undefined): void {
    if (command === undefined || command.disabled === true) return
    command.run()
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((value) => nextIndex(flat, value, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setActive(nextIndex(flat, -1, 1))
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setActive(nextIndex(flat, -1, -1))
      return
    }
    if (event.key === 'Tab') {
      // Modal: the tab key must not walk the panel behind the dialog.
      event.preventDefault()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runCommand(current)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Navigator commands"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-xl">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={current === undefined ? undefined : optionId(current)}
            aria-label="Type a command"
            placeholder="Type a command…"
            autoComplete="off"
            spellCheck={false}
            className="h-6 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="shrink-0 rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="palette-list"
          role="listbox"
          aria-label="Matching commands"
          aria-activedescendant={current === undefined ? undefined : optionId(current)}
          className="max-h-80 overflow-y-auto p-1"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {query.trim() === ''
                ? 'Nothing Navigator can do right now.'
                : `No command matches “${queryTitle(query)}”.`}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.group} role="group" aria-labelledby={`palette-group-${group.group}`}>
                <h3
                  id={`palette-group-${group.group}`}
                  className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {group.group}
                </h3>
                {group.items.map((command) => {
                  const index = flat.indexOf(command)
                  const selected = index === active
                  const detail = command.disabled === true ? (command.reason ?? command.hint) : command.hint
                  return (
                    <div
                      key={command.id}
                      id={optionId(command)}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={command.disabled === true}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        runCommand(command)
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left',
                        selected ? 'bg-primary/10' : 'hover:bg-muted',
                        command.disabled === true && 'cursor-default opacity-50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{command.title}</span>
                        {detail === undefined ? null : (
                          <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
                        )}
                      </span>
                      {selected && command.disabled !== true ? (
                        <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-card px-1 font-semibold">↑</kbd>
            <kbd className="rounded border bg-card px-1 font-semibold">↓</kbd> to move
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-card px-1 font-semibold">Enter</kbd> to run
          </span>
          <span className="ml-auto">
            <kbd className="rounded border bg-card px-1 font-semibold">{shortcutLabel}</kbd> to open
          </span>
        </div>
      </div>
    </div>
  )
}
