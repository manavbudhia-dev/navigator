import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowRight,
  ChevronDown,
  Layers,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Paperclip,
  Play,
  Plug,
  Send,
  Sparkle,
  Square,
  Wifi,
} from 'lucide-react'

import { StatusPill, type ConnectionStatus } from '../components/StatusPill'
import { CostText } from '../components/CostText'
import { useTaskBridge } from '../useTaskBridge'
import { formatWhen, loadSessions, type AuditSession } from '@/memory/history'
import { inExtension } from '@/lib/extension'
import { cn } from '@/lib/utils'
import { AGENT_MODES, MODE_LABELS, type AgentMode } from '@/types/agent'
import type { TaskEvent } from '@/types/task'
import type { BackgroundMessage, BackgroundResponse, PageMeta } from '@/types/messages'

const MODE_DESCRIPTIONS: Record<AgentMode, string> = {
  observe: 'Read-only, never acts',
  copilot: 'Approve important actions',
  auto: 'Acts alone on allowlisted sites',
}

const OUTCOME_LABELS: Record<AuditSession['outcome'], string> = {
  success: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
  unknown: 'No finish',
}

type ActiveTabInfo = {
  title: string
  hostname: string
  favIconUrl?: string | undefined
}

export function AgentPanel({ onOpenHistory }: { onOpenHistory: () => void }) {
  const [goal, setGoal] = useState('')
  const [expanded, setExpanded] = useState(true)
  const [mode, setMode] = useState<AgentMode>('copilot')
  const [modeOpen, setModeOpen] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [perception, setPerception] = useState<{
    elements: number
    inViewport: number
    tokens: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTabInfo | null>(null)
  const [answerDraft, setAnswerDraft] = useState('')
  const [overlayOn, setOverlayOn] = useState(false)
  const [sessions, setSessions] = useState<AuditSession[]>([])
  const timelineRef = useRef<HTMLOListElement>(null)
  const task = useTaskBridge()

  const runDiagnostics = useCallback(async () => {
    if (!inExtension) {
      setStatus('error')
      setError('Not running inside Chrome. Load the built extension to test the connection.')
      return
    }
    setStatus('checking')
    setError(null)
    try {
      const message: BackgroundMessage = { kind: 'ping-active-tab' }
      const response = (await chrome.runtime.sendMessage(message)) as BackgroundResponse
      if (response.ok && 'meta' in response) {
        setMeta(response.meta)
        setStatus('connected')
        const stateMessage: BackgroundMessage = { kind: 'get-page-state-active-tab' }
        const stateResponse = (await chrome.runtime.sendMessage(stateMessage)) as BackgroundResponse
        if (stateResponse.ok && 'pageState' in stateResponse) {
          setPerception({
            elements: stateResponse.pageState.elementCount,
            inViewport: stateResponse.pageState.inViewportCount,
            tokens: stateResponse.pageState.tokenEstimate,
          })
        }
      } else if (!response.ok) {
        setStatus('error')
        setError(response.error)
      }
    } catch (cause) {
      setStatus('error')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    if (!inExtension) return
    void chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => {
        if (!tab) return
        let hostname = ''
        try {
          hostname = tab.url ? new URL(tab.url).hostname : ''
        } catch {
          hostname = ''
        }
        setActiveTab({ title: tab.title || 'Untitled', hostname, favIconUrl: tab.favIconUrl })
      })
      .catch(() => setActiveTab(null))
    void runDiagnostics()
  }, [runDiagnostics])

  const finished = task.events.some((event) => event.type === 'done' || event.type === 'failed')

  useEffect(() => {
    loadSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
  }, [finished])

  useEffect(() => {
    const list = timelineRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [task.events])

  const overlayMessage = useCallback(async (visible: boolean) => {
    if (!inExtension) return
    setOverlayOn(visible)
    try {
      const message: BackgroundMessage = { kind: 'set-overlay', visible }
      const response = (await chrome.runtime.sendMessage(message)) as BackgroundResponse
      if (!response.ok) setOverlayOn(!visible)
    } catch {
      setOverlayOn(!visible)
    }
  }, [])

  async function handleRun() {
    const trimmed = goal.trim()
    if (trimmed.length === 0 || task.running) return
    await task.start(trimmed, mode)
  }

  const canSend = goal.trim().length > 0 && !task.running

  return (
    <div className="flex flex-col gap-5 p-4">
      <section>
        <h2 className="text-[22px] font-bold tracking-tight">What can I help you do?</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Describe a task. I&apos;ll work across your open tabs.
        </p>
      </section>

      <section className="rounded-xl border bg-card p-3">
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={expanded ? 3 : 1}
          placeholder="e.g. Find 3 Chrome extension boilerplates on GitHub and compare their stars..."
          aria-label="Task description"
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            disabled
            title="File attachments arrive with the form filler (Batch 7)"
            aria-label="Attach file"
            className="rounded-lg p-1.5 text-muted-foreground disabled:opacity-60"
          >
            <Paperclip className="size-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? 'Collapse input' : 'Expand input'}
            aria-expanded={expanded}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDown
              className={cn('size-4 transition-transform', !expanded && 'rotate-180')}
              strokeWidth={1.8}
            />
          </button>
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={!canSend}
            aria-label="Send task"
            className={cn(
              'ml-auto rounded-lg p-2 transition-colors',
              canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground/70',
            )}
          >
            <ArrowRight className="size-4" strokeWidth={2} />
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold">Execution mode</span>
          <Info className="size-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden />
        </div>
        <div className="flex items-stretch gap-2.5">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setModeOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={modeOpen}
              className="flex w-full items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left transition-colors hover:bg-muted/50"
            >
              <Sparkle className="size-4 shrink-0 text-primary" fill="currentColor" strokeWidth={0} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{MODE_LABELS[mode].split(' (')[0]}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {MODE_DESCRIPTIONS[mode]}
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
            </button>
            {modeOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close mode picker"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setModeOpen(false)}
                />
                <div
                  role="listbox"
                  aria-label="Execution mode"
                  className="absolute z-20 mt-1 w-full rounded-xl border bg-card p-1 shadow-lg"
                >
                  {AGENT_MODES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="option"
                      aria-selected={value === mode}
                      onClick={() => {
                        setMode(value)
                        setModeOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left',
                        value === mode ? 'bg-primary/10' : 'hover:bg-muted',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">
                          {MODE_LABELS[value].split(' (')[0]}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {MODE_DESCRIPTIONS[value]}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          {task.running ? (
            <button
              type="button"
              onClick={() => void task.stop()}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              <Square className="size-4" strokeWidth={2} aria-hidden />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleRun()}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Play className="size-4" strokeWidth={2} aria-hidden />
              Run task
            </button>
          )}
        </div>
        {task.startError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
            {task.startError}
          </p>
        ) : null}
      </section>

      {task.events.length > 0 ? (
        <section className="flex flex-col gap-2">
          {task.approval ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                Approve: {task.approval.summary}
              </p>
              <p className="mt-0.5 text-xs text-amber-800">
                risk: {task.approval.level}
                {task.approval.hardBlock ? ` · hard block (${task.approval.hardBlock})` : ''}
                {task.approval.reasons.length > 0 ? ` · ${task.approval.reasons.join('; ')}` : ''}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void task.answerApproval(task.approval?.id ?? '', true)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Allow once
                </button>
                <button
                  type="button"
                  onClick={() => void task.answerApproval(task.approval?.id ?? '', false)}
                  className="rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                >
                  Deny
                </button>
              </div>
            </div>
          ) : null}

          {task.question ? (
            <div className="rounded-xl border border-blue-300 bg-blue-50 p-3">
              <p className="text-sm font-semibold text-blue-900">{task.question.question}</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={answerDraft}
                  onChange={(event) => setAnswerDraft(event.target.value)}
                  placeholder="Your answer…"
                  className="h-8 min-w-0 flex-1 rounded-lg border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => {
                    void task.answerQuestion(task.question?.id ?? '', answerDraft || '(no answer)')
                    setAnswerDraft('')
                  }}
                  className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="size-3.5" strokeWidth={2} aria-hidden />
                  Send
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold">Live task</h3>
              <StatusPill status={task.running ? 'checking' : 'connected'} className="ml-auto" />
            </div>
            <ol
              ref={timelineRef}
              className="flex max-h-72 flex-col gap-1.5 overflow-y-auto border-l border-border pl-3 text-xs"
            >
              {task.events.map((event, index) => (
                <li key={index} className="relative">
                  <span
                    className="absolute -left-[calc(0.75rem+2.5px)] top-1.5 size-1.5 rounded-full bg-primary/50"
                    aria-hidden
                  />
                  <TimelineRow event={event} />
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-3">
        <p className="mb-2 text-xs text-muted-foreground">Active tab</p>
        <div className="flex items-center gap-2.5">
          {activeTab?.favIconUrl ? (
            <img
              src={activeTab.favIconUrl}
              alt=""
              className="size-6 shrink-0 rounded-full"
              width={24}
              height={24}
            />
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
              <Globe className="size-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden />
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold">{activeTab?.title ?? '—'}</span>
            {activeTab?.hostname ? (
              <span className="text-muted-foreground"> · {activeTab.hostname}</span>
            ) : null}
          </p>
          <StatusPill status={status === 'connected' ? 'connected' : status} />
          <button
            type="button"
            disabled={!activeTab}
            title="Focus this tab"
            aria-label="Focus active tab"
            onClick={() => {
              void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
                if (tab?.id !== undefined) void chrome.tabs.update(tab.id, { active: true })
              })
            }}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <ExternalLink className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-3">
        <div className="flex items-center gap-2">
          <Plug className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden />
          <h3 className="text-sm font-semibold">Browser connection</h3>
          <StatusPill status={status} className="ml-auto" />
        </div>
        <div className="mt-3 flex items-start gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full',
              status === 'error' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600',
            )}
          >
            <Wifi className="size-5" strokeWidth={1.8} aria-hidden />
          </span>
          <p className="min-w-0 flex-1 pt-1 text-[13px] leading-snug text-muted-foreground">
            {status === 'error' && error
              ? error
              : 'Side panel, service worker, and content script are communicating.'}
          </p>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void runDiagnostics()}
            disabled={status === 'checking'}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-60"
          >
            <Activity className="size-4" strokeWidth={2} aria-hidden />
            {status === 'checking' ? 'Running…' : 'Run diagnostics'}
          </button>
          <button
            type="button"
            onClick={() => void overlayMessage(!overlayOn)}
            disabled={!inExtension}
            aria-pressed={overlayOn}
            title="Number every element the agent can see"
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50',
              overlayOn
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-foreground hover:bg-muted/70',
            )}
          >
            <Layers className="size-4" strokeWidth={2} aria-hidden />
            {overlayOn ? 'Hide element map' : 'Show element map'}
          </button>
        </div>
        {meta ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {meta.title} · scrolled {meta.scrollPercent}% · {meta.pageHeightPx}px page
            {perception
              ? ` · ${perception.elements} interactive elements (${perception.inViewport} in viewport) · ~${perception.tokens} tokens`
              : ''}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Recent activity</h3>
          <button
            type="button"
            onClick={onOpenHistory}
            className="text-xs font-semibold text-primary hover:underline"
          >
            View all
          </button>
        </div>
        {sessions.length === 0 ? (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            No tasks recorded yet. Run one and every action lands here.
          </p>
        ) : (
          sessions.slice(0, 3).map((session) => (
            <article
              key={session.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/50"
              onClick={onOpenHistory}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <FileText className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{clip(session.goal, 60)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {session.actions} action{session.actions === 1 ? '' : 's'} ·{' '}
                  {formatWhen(session.startedAt)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                {OUTCOME_LABELS[session.outcome]}
              </span>
            </article>
          ))
        )}
      </section>
    </div>
  )
}

function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function TimelineRow({ event }: { event: TaskEvent }) {
  switch (event.type) {
    case 'step':
      return <div className="mt-1 font-semibold text-muted-foreground">Step {event.n}</div>
    case 'thinking':
      return <div className="italic text-muted-foreground">{clip(event.text)}</div>
    case 'action':
      return <div>→ {event.summary}</div>
    case 'result':
      return (
        <div className={event.ok ? 'text-emerald-600' : 'text-red-600'}>
          {event.ok ? '✓' : '✗'} {clip(event.content)}
        </div>
      )
    case 'blocked':
      return (
        <div className="text-red-600">
          ⛔ {event.tool}: {event.reason}
        </div>
      )
    case 'approval':
      return <div className="text-amber-700">⏳ awaiting approval: {clip(event.summary)}</div>
    case 'approval-resolved':
      return <div className="text-muted-foreground">{event.approved ? 'approved' : 'denied'}</div>
    case 'question':
      return <div className="text-blue-700">❓ {clip(event.question)}</div>
    case 'question-resolved':
      return null
    case 'note':
      return <div className="text-amber-700">ℹ {event.text}</div>
    case 'done':
      return (
        <div className="mt-1 font-semibold">
          {event.success ? 'Done' : 'Failed'} — {clip(event.summary)} · {event.steps} steps ·{' '}
          <CostText usage={event} />
        </div>
      )
    case 'failed':
      return <div className="mt-1 font-semibold text-red-600">Failed: {event.error}</div>
  }
}
