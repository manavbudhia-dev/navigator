import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Trash2, X } from 'lucide-react'

import { clearMemories, deleteMemory, listMemories } from '@/memory/entries'
import { MAX_MEMORIES, rankMemories, whenLabel } from '@/memory/recall'
import { cn } from '@/lib/utils'
import { hostOf } from '@/tabs/model'
import type { MemoryEntry } from '@/memory/entries'

/**
 * What Navigator remembers about you (spec §4). The agent writes these notes
 * with `save_to_memory` and reads them back with `recall_memory`; this card is
 * the only place they can be seen and thrown away. Plain text in IndexedDB on
 * this machine — nothing secret belongs here, and the search box runs the same
 * keyword ranking the tool uses.
 */

function Note({ entry, onDelete }: { entry: MemoryEntry; onDelete: (id: number) => void }) {
  const site = entry.url === '' ? '' : hostOf(entry.url)
  return (
    <li className="flex items-start gap-2 rounded-xl border bg-card p-3" data-memory-note>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm">{entry.text}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {entry.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              #{tag}
            </span>
          ))}
          {site === '' ? null : (
            <span title={entry.url} className="truncate rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {site}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-muted-foreground">{whenLabel(entry.at)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void onDelete(entry.id)}
        aria-label="Forget this note"
        title="Forget this note"
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="size-4" strokeWidth={1.8} />
      </button>
    </li>
  )
}

export function MemoryLibrary() {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setEntries(await listMemories())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setEntries([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const shown = useMemo(
    () => (entries === null ? [] : rankMemories(query, entries, Math.max(1, entries.length))),
    [entries, query],
  )

  const remove = useCallback(
    async (id: number): Promise<void> => {
      await deleteMemory(id)
      setEntries((prev) => (prev === null ? prev : prev.filter((entry) => entry.id !== id)))
    },
    [],
  )

  const clearAll = useCallback(async (): Promise<void> => {
    await clearMemories()
    setConfirmClear(false)
    setQuery('')
    await reload()
  }, [reload])

  const count = entries === null ? 0 : entries.length

  return (
    <section className="flex flex-col gap-2" data-memory>
      <div className="flex items-center gap-2.5">
        <Brain className="size-5 text-primary" strokeWidth={1.8} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold tracking-tight">Memory</h2>
          <p className="text-xs text-muted-foreground">
            Notes the agent keeps between tasks. Plain text, on this machine only — never a password
            or a card number.
          </p>
        </div>
        {count === 0 ? null : (
          <button
            type="button"
            onClick={() => setConfirmClear((value) => !value)}
            aria-expanded={confirmClear}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
              confirmClear ? 'bg-red-600 text-white hover:bg-red-700' : 'border bg-card hover:bg-muted',
            )}
          >
            {confirmClear ? 'Confirm' : 'Forget all'}
          </button>
        )}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {confirmClear ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="min-w-0 flex-1 text-xs text-red-700">
            Deletes all {count} note{count === 1 ? '' : 's'}. Saved tasks and recipes are untouched.
          </p>
          <button
            type="button"
            onClick={() => void clearAll()}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Delete them
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(false)}
            aria-label="Keep the notes"
            className="rounded-lg p-1.5 text-red-700 transition-colors hover:bg-red-100"
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : null}

      {count === 0 ? null : (
        <label className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
          <Brain className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
          <span className="sr-only">Search memory notes</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search these notes"
            className="h-5 min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
          />
        </label>
      )}

      {entries === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : count === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm font-semibold">Nothing remembered yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            During a task the agent can decide a fact is worth keeping — “she ships to Pune”, “that
            form wants the GST number”. Those notes show up here, and it reads them back on the next
            task instead of asking you again.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          No note matches “{query.trim()}”. Recall is by keyword, so try a word that appears in the
          note or a #tag.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((entry) => (
            <Note key={entry.id} entry={entry} onDelete={remove} />
          ))}
          {count >= MAX_MEMORIES ? (
            <p className="text-[11px] text-amber-700">
              {count} of {MAX_MEMORIES} notes: the oldest are dropped when the list is full.
            </p>
          ) : null}
        </ul>
      )}
    </section>
  )
}
