import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Download, History, RefreshCw } from 'lucide-react'

import { usePricing } from '../usePricing'
import { RecipeLibrary } from '../components/RecipeLibrary'
import { SaveRecipeButton } from '../components/SaveRecipe'
import { saveTextFile, stampedFilename } from '@/lib/download'
import { formatCost, summarizeRun } from '@/memory/cost'
import { buildAuditExport } from '@/memory/export'
import { formatWhen, loadSessions, type AuditSession, type SessionOutcome } from '@/memory/history'
import { cn } from '@/lib/utils'
import { hostOf } from '@/tabs/model'
import type { AuditRow } from '@/memory/db'

const OUTCOME_STYLES: Record<SessionOutcome, string> = {
  success: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-600',
  stopped: 'bg-amber-50 text-amber-700',
  unknown: 'bg-muted text-muted-foreground',
}

const OUTCOME_LABELS: Record<SessionOutcome, string> = {
  success: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
  unknown: 'No finish',
}

const DECISION_STYLES: Record<string, string> = {
  allow: 'bg-muted text-muted-foreground',
  approved: 'bg-green-50 text-green-700',
  block: 'bg-red-50 text-red-600',
  denied: 'bg-red-50 text-red-600',
}

const RISK_STYLES: Record<string, string> = {
  safe: 'bg-muted text-muted-foreground',
  low: 'bg-blue-50 text-blue-700',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-red-50 text-red-600',
}

function clockAt(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** A 320 px picture of the page after the action (spec §9), expandable in place. */
function Thumb({ src, tool }: { src: string; tool: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} the screenshot taken after ${tool}`}
      className="shrink-0 overflow-hidden rounded-md border bg-muted/30"
    >
      <img
        src={src}
        alt=""
        className={cn('transition-all', open ? 'max-h-72 w-48 object-cover' : 'h-9 w-14 object-cover')}
      />
    </button>
  )
}

function StepRow({ row }: { row: AuditRow }) {
  const site = row.url === undefined ? '' : hostOf(row.url)
  return (
    <li className="flex items-start gap-2 border-t py-2 text-xs">
      <span className="shrink-0 tabular-nums text-muted-foreground">{clockAt(row.at)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{row.tool}</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
              RISK_STYLES[row.risk] ?? RISK_STYLES.safe,
            )}
          >
            {row.risk}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
              DECISION_STYLES[row.decision] ?? DECISION_STYLES.allow,
            )}
          >
            {row.decision}
            {row.hardBlock ? `: ${row.hardBlock}` : ''}
          </span>
          {site === '' ? null : (
            <span title={row.url} className="truncate rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {site}
            </span>
          )}
          {row.ms === undefined ? null : (
            <span className="tabular-nums text-[10px] text-muted-foreground">{row.ms} ms</span>
          )}
        </div>
        <p className="mt-0.5 break-words text-muted-foreground">{clip(row.detail, 160)}</p>
      </div>
      {row.thumb === undefined ? null : <Thumb src={row.thumb} tool={row.tool} />}
    </li>
  )
}

function SessionCard({ session, onSaved }: { session: AuditSession; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const pricing = usePricing()
  const run = useMemo(() => summarizeRun(session.rows, pricing), [session.rows, pricing])
  const site = hostOf(session.rows.find((row) => row.url !== undefined)?.url ?? '')
  const tokens = run.promptTokens + run.completionTokens

  return (
    <article className="rounded-xl border bg-card" data-run={session.runId ?? undefined}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{clip(session.goal, 80)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {session.actions} action{session.actions === 1 ? '' : 's'}
            {session.blocked > 0 ? ` · ${session.blocked} blocked` : ''}
            {site === '' ? '' : ` · ${site}`} · {clockAt(session.startedAt)} ·{' '}
            {formatWhen(session.startedAt)}
            {tokens === 0 ? '' : ` · ${tokens} tokens`}
            {tokens === 0 || run.cost === null || pricing === null
              ? ''
              : ` · ${formatCost(run.cost, pricing.symbol)}`}
            {run.medianStepMs === null ? '' : ` · ${(run.medianStepMs / 1000).toFixed(1)}s/step`}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            OUTCOME_STYLES[session.outcome],
          )}
        >
          {OUTCOME_LABELS[session.outcome]}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          strokeWidth={1.8}
          aria-hidden
        />
      </button>
      {run.over.length > 0 ? (
        <p className="border-t px-3 py-2 text-[11px] text-amber-700" role="note" data-over-target>
          Over the per-step target: {run.over.join(' · ')}
        </p>
      ) : null}
      {session.outcome === 'success' ? (
        <div className="border-t px-3 py-2">
          <SaveRecipeButton
            rows={session.rows}
            goal={session.goal}
            runId={session.runId}
            onSaved={onSaved}
          />
        </div>
      ) : null}
      {open ? (
        <ul className="px-3 pb-3">
          {session.rows.map((row, index) => (
            <StepRow key={`${row.at}-${index}`} row={row} />
          ))}
        </ul>
      ) : null}
    </article>
  )
}

export function HistoryPanel() {
  const [sessions, setSessions] = useState<AuditSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [libraryRefresh, setLibraryRefresh] = useState(0)

  const reload = useCallback(async () => {
    setError(null)
    try {
      setSessions(await loadSessions())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSessions([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const exportJson = useCallback(async () => {
    setExporting(true)
    setError(null)
    try {
      await saveTextFile(
        stampedFilename('navigator-audit', 'json'),
        'application/json',
        await buildAuditExport(),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setExporting(false)
    }
  }, [])

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="flex items-center gap-2.5">
        <History className="size-5 text-primary" strokeWidth={1.8} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold tracking-tight">Task history</h2>
          <p className="text-xs text-muted-foreground">Every action the agent took, and who allowed it.</p>
        </div>
        <button
          type="button"
          onClick={() => void exportJson()}
          disabled={exporting || sessions === null || sessions.length === 0}
          aria-label="Export the audit log as JSON"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Download className="size-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => void reload()}
          aria-label="Reload history"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="size-4" strokeWidth={1.8} />
        </button>
      </section>

      <RecipeLibrary refreshKey={libraryRefresh} />

      <section className="flex items-center gap-2 border-t pt-3">
        <h2 className="text-[17px] font-bold tracking-tight">Runs</h2>
        <p className="flex-1 text-xs text-muted-foreground">
          One card per task, newest first.
        </p>
      </section>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {sessions === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm font-semibold">Nothing here yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run a task from the Agent tab — each action it takes is written to this log.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onSaved={() => setLibraryRefresh((value) => value + 1)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
