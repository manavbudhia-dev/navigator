import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Copy,
  FolderInput,
  Layers,
  Loader2,
  MemoryStick,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

import { StatusPill } from '../components/StatusPill'
import { CostText } from '../components/CostText'
import { useTabsBridge } from '../useTabsBridge'
import { deleteSavedSession } from '@/tabs/store'
import { formatIdle } from '@/tabs/stale'
import { formatBytes, hostLabel, hostOf, tabLabel } from '@/tabs/model'
import type { SavedSession, TabIntent, TabLine, TabReport } from '@/tabs/types'
import { formatWhen } from '@/memory/history'
import { cn } from '@/lib/utils'

/**
 * Tabs tab (spec §8): say what you want done in plain language, or press a
 * button that names the same intent. Everything runs through the manager in
 * the service worker so this panel is a renderer of `TabReport`, never a
 * second implementation of the rules.
 */

const EXAMPLES = [
  'close all YouTube tabs',
  'group my work tabs',
  'find the tab with the pricing page',
  'save this session for tomorrow',
]

const ACTIONS: { label: string; hint: string; icon: typeof Layers; intent: TabIntent }[] = [
  {
    label: 'Group similar',
    hint: 'cluster by title + site',
    icon: Layers,
    intent: { kind: 'group', match: { scope: 'all' } },
  },
  {
    label: 'Merge duplicates',
    hint: 'same page open twice',
    icon: Copy,
    intent: { kind: 'merge', match: { scope: 'all' } },
  },
  {
    label: 'Free memory',
    hint: 'suspend the heavy tabs',
    icon: MemoryStick,
    intent: { kind: 'free', match: { scope: 'all' } },
  },
  {
    label: 'Find stale',
    hint: 'untouched for 7 days',
    icon: Archive,
    intent: { kind: 'stale', days: 7 },
  },
  {
    label: 'Index pages',
    hint: 'read tabs for search',
    icon: Search,
    intent: { kind: 'index' },
  },
  {
    label: 'Save session',
    hint: 'reopen it all later',
    icon: Save,
    intent: { kind: 'save', name: '', note: '', tags: [] },
  },
]

const LINE_STYLES: Record<TabLine['kind'], string> = {
  close: 'bg-red-500/60',
  merge: 'bg-red-500/60',
  group: 'bg-primary/60',
  ungroup: 'bg-primary/60',
  switch: 'bg-primary/60',
  discard: 'bg-cyan-500/60',
  index: 'bg-cyan-500/60',
  session: 'bg-green-500/60',
  restore: 'bg-green-500/60',
  search: 'bg-amber-500/60',
  stale: 'bg-amber-500/60',
  skip: 'bg-muted-foreground/40',
  undo: 'bg-green-500/60',
  note: 'bg-muted-foreground/40',
  error: 'bg-red-500',
}

export function TabsPanel() {
  const tabs = useTabsBridge()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [restoreId, setRestoreId] = useState<string | null>(null)

  const report = tabs.report
  const busy = tabs.busy

  // A bulk operation invalidates the selection: those ids may no longer exist.
  useEffect(() => {
    const ids = new Set(report?.tabs.map((tab) => tab.id) ?? [])
    setSelected((prev) => prev.filter((id) => ids.has(id)))
  }, [report])

  const freed = useMemo(
    () => (report === null ? '' : report.freedBytes > 0 ? formatBytes(report.freedBytes) : ''),
    [report],
  )

  const canRun = text.trim().length > 0 && !busy

  async function handleRun() {
    if (!canRun) return
    const command = text.trim()
    setText('')
    await tabs.run(command)
  }

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]))
  }

  async function actOnSelection(intent: TabIntent) {
    await tabs.intent(intent)
  }

  async function forget(session: SavedSession) {
    setRestoreId(session.id)
    await deleteSavedSession(session.id).catch(() => undefined)
    tabs.reloadSessions()
    setRestoreId(null)
  }

  const windows = useMemo(() => groupByWindow(report?.tabs ?? []), [report])

  // Open with the tab list the manager sees, so the panel is never empty by accident.
  useEffect(() => {
    void tabs.intent({ kind: 'list', match: { scope: 'all' } })
  }, [tabs.intent])

  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <h2 className="text-[22px] font-bold tracking-tight">What should I do with your tabs?</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Group, dedupe, search, suspend and save them. Bulk closes can be undone for 60 seconds.
        </p>
      </section>

      <section className="rounded-xl border bg-card p-3">
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRun()
            }}
            placeholder="close all YouTube tabs"
            aria-label="Tab command"
            className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {busy ? (
            <span className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Working
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={!canRun}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/70"
            >
              <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
              Run
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setText(example)}
              aria-label={`Use example command ${example}`}
              className="rounded-full border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
        {tabs.error !== null ? (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
            {tabs.error}
          </p>
        ) : null}
      </section>

      {report !== null && report.undo !== null && tabs.secondsLeft > 0 ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-3" data-undo-seconds={tabs.secondsLeft}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-900">
                {report.undo.tabs} tab{report.undo.tabs === 1 ? '' : 's'} closed
              </p>
              <p className="text-[11px] text-amber-800">
                Reopens them in {tabs.secondsLeft}s unless you undo now.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void tabs.intent({ kind: 'undo' })}
              className="flex items-center gap-1.5 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-900/90"
            >
              <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
              Undo
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Quick actions</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {ACTIONS.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => void tabs.intent(action.intent)}
                disabled={busy}
                aria-label={action.label}
                className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">{action.label}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{action.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {report !== null ? (
        <section className="rounded-xl border bg-card p-3" data-report data-intent={report.intent}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{report.summary}</h3>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {report.promptTokens + report.completionTokens > 0 ? (
                <CostText usage={report} />
              ) : (
                'no model used'
              )}
            </span>
          </div>
          {report.lines.length > 0 ? (
            <ul className="flex flex-col gap-1.5 border-l border-border pl-3 text-xs">
              {report.lines.map((line, index) => (
                <li key={index} className="relative flex gap-2">
                  <span
                    className={cn(
                      'absolute -left-[calc(0.75rem+2.5px)] top-1.5 size-1.5 rounded-full',
                      LINE_STYLES[line.kind],
                    )}
                    aria-hidden
                  />
                  <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {line.kind}
                  </span>
                  <span className={cn('min-w-0 flex-1', line.kind === 'error' && 'text-red-700')}>
                    {line.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing was changed.</p>
          )}
          {freed !== '' ? (
            <p className="mt-2 rounded-lg bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-900">
              {freed} of memory freed (estimate)
            </p>
          ) : null}
          {report.error !== null ? (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {report.error}
            </p>
          ) : null}

          {report.found.length > 0 ? (
            <div
              className="mt-3 rounded-lg bg-muted/40 p-2.5"
              data-found={report.found.length}
              data-found-where={report.found.map((hit) => hit.where).join(',')}
            >
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Matches
              </p>
              <ul className="flex flex-col gap-2">
                {report.found.map((hit) => (                  <li key={hit.tab.id} className="text-xs">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {hit.where}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={hit.tab.url}
                          target="_blank"
                          rel="noreferrer"
                          className="break-words font-semibold hover:underline"
                        >
                          {tabLabel(hit.tab)}
                        </a>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {hostOf(hit.tab.url) || 'no host'} · matched {Math.round(hit.score * 100)}%
                        </p>
                        {hit.snippet !== '' ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">{hit.snippet}</p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.stale.length > 0 ? (
            <div className="mt-3 rounded-lg bg-amber-50 p-2.5" data-stale={report.stale.length}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                Archive these?
              </p>
              <ul className="flex flex-col gap-1 text-[11px] text-amber-900">
                {report.stale.map((entry) => (
                  <li key={entry.tab.id} className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate">{tabLabel(entry.tab)}</span>
                    <span className="shrink-0 font-semibold">
                      {formatIdle(entry.daysIdle)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    void actOnSelection({
                      kind: 'free',
                      match: { scope: 'ids', ids: report.stale.map((entry) => entry.tab.id) },
                      maxTabs: report.stale.length,
                    })
                  }
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                >
                  <MemoryStick className="size-3" strokeWidth={2} aria-hidden />
                  Suspend them
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void actOnSelection({
                      kind: 'close',
                      match: { scope: 'ids', ids: report.stale.map((entry) => entry.tab.id) },
                    })
                  }
                  className="flex items-center gap-1 rounded-lg bg-amber-900 px-2.5 py-1 text-[11px] font-semibold text-amber-50 transition-colors hover:bg-amber-900/90"
                >
                  <Trash2 className="size-3" strokeWidth={2} aria-hidden />
                  Close them
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-amber-800">
                Nothing here is closed automatically. Closing keeps a 60-second undo, and pinned tabs
                are never proposed.
              </p>
            </div>
          ) : null}

          {report.sessions.length > 0 ? (
            <div className="mt-3 rounded-lg bg-muted/40 p-2.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                From the report
              </p>
              <ul className="flex flex-col gap-1 text-[11px]">
                {report.sessions.map((session) => (
                  <li key={session.id} className="truncate">
                    <span className="font-semibold">{session.name}</span> · {session.tabs.length} tabs
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {report !== null ? (
        <section className="rounded-xl border bg-card p-3" data-open-tabs={report.tabs.length}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Open tabs</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {report.tabs.length} open
            </span>
            <StatusPill
              status={report.ok ? 'connected' : 'error'}
              className={cn(report.ok ? '' : 'ml-0')}
            />
            <button
              type="button"
              onClick={() => void tabs.intent({ kind: 'list', match: { scope: 'all' } })}
              disabled={busy}
              className="ml-auto rounded-lg border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              Refresh
            </button>
          </div>

          {selected.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-primary/5 p-2" data-selected={selected.length}>
              <span className="text-[11px] font-semibold text-primary">{selected.length} selected</span>
              <button
                type="button"
                onClick={() => void actOnSelection({ kind: 'group', match: { scope: 'ids', ids: selected } })}
                className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-muted"
              >
                <Layers className="size-3" strokeWidth={2} aria-hidden />
                Group
              </button>
              <button
                type="button"
                onClick={() => void actOnSelection({ kind: 'close', match: { scope: 'ids', ids: selected } })}
                className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50"
              >
                <Trash2 className="size-3" strokeWidth={2} aria-hidden />
                Close
              </button>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="ml-auto text-[11px] text-muted-foreground hover:underline"
              >
                Clear
              </button>
            </div>
          ) : null}

          {report.tabs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No snapshot yet — run a command or a quick action and the live tab list appears here.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {windows.map((group) => (
                <li key={group.key} className="flex flex-col gap-1">
                  {group.label !== '' ? (
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </p>
                  ) : null}
                  {group.tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs',
                        tab.active && 'border-primary/50 bg-primary/5',
                        selected.includes(tab.id) && 'bg-primary/10',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(tab.id)}
                        onChange={() => toggle(tab.id)}
                        aria-label={`Select tab ${tab.id}`}
                        className="size-3.5 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{tabLabel(tab)}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          [{tab.id}] {hostLabel(tab.url)}
                          {tab.groupId >= 0 ? ` · group ${tab.groupId}` : ''}
                          {tab.discarded ? ' · suspended' : ''}
                          {tab.pinned ? ' · pinned' : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void actOnSelection({ kind: 'close', match: { scope: 'ids', ids: [tab.id] } })}
                        aria-label={`Close tab ${tab.id}`}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="size-3.5" strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">Saved sessions</h3>
          <button
            type="button"
            onClick={() => void tabs.intent({ kind: 'sessions' })}
            disabled={busy}
            className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary disabled:opacity-60"
          >
            <FolderInput className="size-3.5" strokeWidth={1.8} aria-hidden />
            Compare with open tabs
          </button>
        </div>
        {tabs.sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing saved yet. Say "save this session for tomorrow", or press Save session above.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tabs.sessions.map((session) => (
              <li key={session.id} className="text-xs">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{session.name}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {session.tabs.length} tabs · {formatWhen(session.createdAt)}
                      {session.tags.length > 0 ? ` · ${session.tags.join(', ')}` : ''}
                    </p>
                    {session.note !== '' ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">{session.note}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void tabs.intent({ kind: 'restore', name: session.name })}
                    disabled={busy || restoreId === session.id}
                    aria-label={`Restore session ${session.name}`}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                  >
                    <RotateCcw className="size-3" strokeWidth={2} aria-hidden />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => void forget(session)}
                    aria-label={`Delete session ${session.name}`}
                    className="shrink-0 rounded-lg border p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report !== null && selected.length === 0 ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          Tip: tick tabs above to group or close exactly those.
        </p>
      ) : null}
    </div>
  )
}

/** Windowed so a group header never implies Chrome grouped across windows. */
function groupByWindow(tabs: TabReport['tabs']): { key: string; label: string; tabs: TabReport['tabs'] }[] {
  if (tabs.length === 0) return []
  const byWindow = new Map<number, TabReport['tabs']>()
  for (const tab of tabs) {
    const bucket = byWindow.get(tab.windowId)
    if (bucket === undefined) byWindow.set(tab.windowId, [tab])
    else bucket.push(tab)
  }
  const out: { key: string; label: string; tabs: TabReport['tabs'] }[] = []
  for (const [windowId, list] of [...byWindow].sort((a, b) => a[0] - b[0])) {
    out.push({
      key: `w${windowId}`,
      label: byWindow.size > 1 ? `Window ${windowId}` : '',
      tabs: list,
    })
  }
  return out
}
