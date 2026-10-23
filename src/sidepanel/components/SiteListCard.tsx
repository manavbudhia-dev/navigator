import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, ShieldX, X, XCircle } from 'lucide-react'

import { addRule, normalizeHost, removeRule } from '@/safety/siteRules'
import {
  clearAllowlist,
  clearBlocklist,
  loadAllowlist,
  loadBlocklist,
  saveAllowlist,
  saveBlocklist,
} from '@/safety/siteRulesStore'

import type { SiteRule } from '@/safety/siteRules'

/**
 * The panel writes Dexie directly, like it does for the model config: only
 * Chrome-dependent work needs the worker, and these lists are read again by the
 * worker when the next task starts. A module-level table, not props, so the
 * read effect below can never be handed a fresh function every render.
 */
const STORE: Record<
  SiteRule,
  {
    load: () => Promise<string[]>
    save: (hosts: readonly string[]) => Promise<string[]>
    clear: () => Promise<void>
  }
> = {
  allow: { load: loadAllowlist, save: saveAllowlist, clear: clearAllowlist },
  block: { load: loadBlocklist, save: saveBlocklist, clear: clearBlocklist },
}

interface SiteListCardProps {
  /** Which list this card edits; also the value of the `data-site-*` hooks. */
  list: SiteRule
  title: string
  description: string
  inputLabel: string
  emptyHint: string
  /** `Stop allowing ${host}` on one card, `Stop blocking ${host}` on the other. */
  removePrefix: string
  clearLabel: string
}

/**
 * One editable site list (spec §9). The wording and the storage differ per
 * list; the rules — normalize on the way in, save on every change, never let a
 * junk value become a rule — are the same for both, so they live here once.
 */
export function SiteListCard({
  list,
  title,
  description,
  inputLabel,
  emptyHint,
  removePrefix,
  clearLabel,
}: SiteListCardProps) {
  const [hosts, setHosts] = useState<string[] | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    void STORE[list]
      .load()
      .then((value) => {
        if (alive) setHosts(value)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setHosts(null)
        setError(cause instanceof Error ? cause.message : 'Could not read the saved list.')
      })
    return () => {
      alive = false
    }
  }, [list, reload])

  /**
   * Saved on every change rather than behind a Save button: a rule you can see
   * but have to remember to commit is a rule that is not there.
   */
  async function handleAdd(): Promise<void> {
    const host = normalizeHost(draft)
    if (host === '') {
      setError('Type a site address, like example.com')
      return
    }
    try {
      setHosts(await STORE[list].save(addRule(hosts ?? [], host)))
      setDraft('')
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the site.')
    }
  }

  async function handleRemove(host: string): Promise<void> {
    try {
      setHosts(await STORE[list].save(removeRule(hosts ?? [], host)))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the site.')
    }
  }

  async function handleClear(): Promise<void> {
    try {
      await STORE[list].clear()
      setHosts([])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear the list.')
    }
  }

  const Icon = list === 'allow' ? ShieldCheck : ShieldX

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-3" data-site-list={list}>
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void handleAdd()
          }}
          placeholder="example.com"
          aria-label={inputLabel}
          spellCheck={false}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={hosts === null || draft.trim() === ''}
          className="h-9 shrink-0 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          Add
        </button>
      </div>

      {hosts === null ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Reading the saved list…
        </p>
      ) : hosts.length === 0 ? (
        <p
          className="rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground"
          data-site-empty={list}
        >
          {emptyHint}
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-site-rows={list}>
          {hosts.map((host) => (
            <li key={host} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium">{host}</span>
              <button
                type="button"
                onClick={() => void handleRemove(host)}
                aria-label={`${removePrefix} ${host}`}
                title={`${removePrefix} ${host}`}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-card hover:text-red-600"
              >
                <X className="size-3.5" strokeWidth={1.8} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hosts !== null && hosts.length > 0 ? (
        <button
          type="button"
          onClick={() => void handleClear()}
          className="self-start text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {clearLabel}
        </button>
      ) : null}

      {error ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
          <XCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
          {hosts === null ? (
            <button
              type="button"
              onClick={() => setReload((key) => key + 1)}
              className="rounded-md border px-2 py-0.5 font-medium hover:bg-muted"
            >
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  )
}
