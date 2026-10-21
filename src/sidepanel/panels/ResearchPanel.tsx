import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  Loader2,
  MessagesSquare,
  Search,
  Send,
  ShieldCheck,
  Square,
  Sparkle,
  Trash2,
} from 'lucide-react'

import { StatusPill } from '../components/StatusPill'
import { CostText } from '../components/CostText'
import { useResearchBridge, type FollowupReply } from '../useResearchBridge'
import { saveTextFile } from '@/lib/download'
import { layoutAnswer, type SentencePart } from '@/research/citations'
import {
  downloadName,
  FORMATS,
  formatMeta,
  render,
  type ResearchFormat,
} from '@/research/format'
import {
  deleteResearchRun,
  listResearchRuns,
  loadResearchResult,
  loadTabConcurrency,
  saveTabConcurrency,
} from '@/research/store'
import {
  clampConcurrency,
  DEPTH_PLANS,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  type ResearchDepth,
  type ResearchEvent,
  type ResearchResult,
} from '@/research/types'
import { formatWhen } from '@/memory/history'
import { type ResearchRunRow } from '@/memory/db'
import { cn } from '@/lib/utils'

/**
 * Research tab (spec §7): ask a question, watch plan → gather → synthesis, read
 * the cited answer, hover a sentence for its sources, export it in five
 * formats, then keep asking questions of the same gathered corpus.
 */

const DEPTHS: { id: ResearchDepth; label: string; hint: string }[] = (
  ['quick', 'standard', 'deep'] as ResearchDepth[]
).map((depth) => {
  const plan = DEPTH_PLANS[depth]
  return {
    id: depth,
    label: depth === 'quick' ? 'Quick' : depth === 'standard' ? 'Standard' : 'Deep',
    hint: `${plan.subQuestions[0]}–${plan.subQuestions[1]} questions · ${plan.rounds} round${plan.rounds === 1 ? '' : 's'}`,
  }
})

const TEXTAREA =
  'w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/70'

type Turn = { question: string; answer: string }

export function ResearchPanel() {
  const research = useResearchBridge()
  const [question, setQuestion] = useState('')
  const [depth, setDepth] = useState<ResearchDepth>('standard')
  const [format, setFormat] = useState<ResearchFormat>('markdown')
  const [schema, setSchema] = useState('')
  const [showExport, setShowExport] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState<SentencePart | null>(null)
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [runs, setRuns] = useState<ResearchRunRow[]>([])
  const [tabs, setTabs] = useState(DEFAULT_CONCURRENCY)
  const feedRef = useRef<HTMLOListElement>(null)

  const result = research.result
  const reloadRuns = useCallback(() => {
    listResearchRuns()
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [])

  useEffect(() => {
    loadTabConcurrency()
      .then(setTabs)
      .catch(() => undefined)
  }, [])

  async function changeTabs(value: number) {
    const next = clampConcurrency(value)
    setTabs(next)
    await saveTabConcurrency(next).catch(() => undefined)
  }

  useEffect(() => {
    setTurns([])
    setAskError(null)
    reloadRuns()
  }, [reloadRuns, result?.id])

  const maxPages = useMemo(() => {
    const plan = DEPTH_PLANS[depth]
    return plan.pagesPerQuery * plan.queriesPerSub * plan.subQuestions[1]
  }, [depth])

  useEffect(() => {
    const list = feedRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [research.events])

  const lines = useMemo(
    () => (result === null ? [] : layoutAnswer(result.answer, result.sources)),
    [result],
  )

  const canRun = question.trim().length > 0 && !research.running

  async function handleRun() {
    if (!canRun) return
    setHovered(null)
    setShowExport(false)
    await research.run(question.trim(), depth)
  }

  async function handleCopy() {
    if (result === null) return
    const ok = await copyText(render(result, format, format === 'json' ? schema : undefined))
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 1600)
  }

  async function handleDownload() {
    if (result === null) return
    await saveTextFile(
      downloadName(result.question, format),
      formatMeta(format).mime,
      render(result, format, format === 'json' ? schema : undefined),
    )
  }

  async function handleAsk() {
    const text = draft.trim()
    if (result === null || text.length === 0 || asking) return
    setAsking(true)
    setAskError(null)
    setDraft('')
    const reply: FollowupReply = await research.ask(result.id, text)
    setAsking(false)
    if (reply.ok && reply.answer !== undefined) setTurns((prev) => [...prev, { question: text, answer: reply.answer ?? '' }])
    else setAskError(reply.error ?? 'The follow-up failed.')
  }

  async function openRun(id: string) {
    const stored = await loadResearchResult(id).catch(() => null)
    if (stored !== null) research.show(stored)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <h2 className="text-[22px] font-bold tracking-tight">What should I research?</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          I open background tabs, read each page, score it, then write the answer with citations.
        </p>
      </section>

      <section className="rounded-xl border bg-card p-3">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          placeholder="e.g. Do heat pumps actually cut heating bills in cold climates?"
          aria-label="Research question"
          className={TEXTAREA}
        />
        <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="Research depth">
          {DEPTHS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setDepth(option.id)}
              aria-pressed={option.id === depth}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-left transition-colors',
                option.id === depth
                  ? 'border-primary bg-primary/10'
                  : 'hover:bg-muted/60',
              )}
            >
              <span className="block text-xs font-semibold">{option.label}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {research.running ? (
            <button
              type="button"
              onClick={() => void research.stop()}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700"
            >
              <Square className="size-3.5" strokeWidth={2} aria-hidden />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={!canRun}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/70"
            >
              <Search className="size-3.5" strokeWidth={2} aria-hidden />
              Research
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground" data-tabs={tabs}>
            <span>pages at most {maxPages}</span>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1">
              <span>tabs</span>
              <button
                type="button"
                onClick={() => void changeTabs(tabs - 1)}
                aria-label="Fewer background tabs"
                className="rounded border px-1.5 py-0.5 font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                disabled={tabs <= 1 || research.running}
              >
                −
              </button>
              <span className="w-4 text-center font-semibold tabular-nums text-foreground">{tabs}</span>
              <button
                type="button"
                onClick={() => void changeTabs(tabs + 1)}
                aria-label="More background tabs"
                className="rounded border px-1.5 py-0.5 font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                disabled={tabs >= MAX_CONCURRENCY || research.running}
              >
                +
              </button>
            </span>
          </div>
        </div>
        {research.startError ? (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
            {research.startError}
          </p>
        ) : null}
        {research.failure ? (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
            {research.failure}
          </p>
        ) : null}
      </section>

      {research.running || research.events.length > 0 ? (
        <section className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Live pipeline</h3>
            <StatusPill status={research.running ? 'checking' : 'connected'} className="ml-auto" />
          </div>
          <ol
            ref={feedRef}
            className="flex max-h-60 flex-col gap-1.5 overflow-y-auto border-l border-border pl-3 text-xs"
          >
            {research.events.map((event, index) => (
              <li key={index} className="relative">
                <span
                  className="absolute -left-[calc(0.75rem+2.5px)] top-1.5 size-1.5 rounded-full bg-primary/50"
                  aria-hidden
                />
                <FeedRow event={event} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {result === null ? (
        !research.running ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm font-semibold">No report yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask a question above. Every kept source, dropped page and citation is stored so you can
              reopen the report later.
            </p>
          </div>
        ) : null
      ) : (
        <>
          <section className="rounded-xl border bg-card p-3" data-result-id={result.id}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Answer</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {result.depth} · {result.sources.length} sources · {result.rounds} round
                {result.rounds === 1 ? '' : 's'}
              </span>
              <CostText
                usage={result}
                className="ml-auto text-[10px] text-muted-foreground"
              />
            </div>

            <div className="flex flex-col gap-1.5 text-[13px] leading-snug">
              {lines.map((line, index) => (
                <LineView key={index} line={line} onHover={setHovered} />
              ))}
            </div>

            {result.gaps.length > 0 ? (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Still open: {result.gaps.slice(0, 3).join(' · ')}
              </p>
            ) : null}
            {result.discarded.length > 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {result.discarded.length} page{result.discarded.length === 1 ? '' : 's'} opened and
                dropped as off-topic or unreadable.
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border bg-card p-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <MessagesSquare className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden />
              Source panel
            </h3>
            {hovered === null || hovered.sources.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Hover any sentence in the answer to see which sources back it.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-xs">
                {hovered.sources.map((n) => {
                  const citation = result.citations.find((entry) => entry.n === n)
                  if (citation === undefined) return null
                  return (
                    <li key={n} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                        [{n}]
                      </span>
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 break-words text-foreground hover:underline"
                      >
                        {citation.title}
                      </a>
                    </li>
                  )
                })}
                <li className="text-[10px] text-muted-foreground">
                  {hovered.explicit ? 'The model cited these.' : 'Matched to these sources by content.'}
                </li>
              </ul>
            )}
          </section>

          {result.contradictions.length > 0 ? (
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <AlertTriangle className="size-4" strokeWidth={1.8} aria-hidden />
                Sources disagree
              </h3>
              <ul className="flex flex-col gap-2">
                {result.contradictions.map((conflict) => (
                  <li key={conflict.clusterId} className="text-xs text-amber-900">
                    <p className="font-semibold">{conflict.topic}</p>
                    <ul className="mt-1 flex flex-col gap-1 border-l border-amber-300 pl-2">
                      {conflict.sides.map((side, i) => (
                        <li key={`${side.sourceId}-${i}`}>
                          {side.claim}{' '}
                          <Cite sourceId={side.sourceId} citations={result.citations} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-xl border bg-card p-3">
            <h3 className="mb-2 text-sm font-semibold">Sources</h3>
            <ul className="flex flex-col gap-2">
              {result.sources.map((note) => {
                const n = result.citations.find((entry) => entry.sourceId === note.id)?.n
                return (
                  <li key={note.id} className="text-xs">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 font-semibold text-muted-foreground">
                        {n ?? '—'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={note.url}
                          target="_blank"
                          rel="noreferrer"
                          className="break-words font-semibold hover:underline"
                        >
                          {note.title}
                        </a>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {hostOf(note.url)}
                          {note.author ? ` · ${note.author}` : ''}
                          {note.publishDate ? ` · ${note.publishDate}` : ''}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {note.summary || (note.claims[0] ?? '')}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          note.credibility >= 0.65
                            ? 'bg-green-50 text-green-700'
                            : note.credibility >= 0.45
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-red-50 text-red-600',
                        )}
                        title={`relevance ${note.relevance.toFixed(2)}`}
                      >
                        <ShieldCheck className="size-3" strokeWidth={2} aria-hidden />
                        {note.credibility.toFixed(2)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold">Export</h3>
              <button
                type="button"
                onClick={() => setShowExport((value) => !value)}
                aria-expanded={showExport}
                className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary"
              >
                <ChevronDown
                  className={cn('size-3.5 transition-transform', showExport && 'rotate-180')}
                  strokeWidth={1.8}
                  aria-hidden
                />
                {showExport ? 'Hide' : 'Preview'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FORMATS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFormat(option.id)}
                  aria-pressed={option.id === format}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
                    option.id === format
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {format === 'json' ? (
              <label className="mt-2 block">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Output schema (optional)
                </span>
                <input
                  value={schema}
                  onChange={(event) => setSchema(event.target.value)}
                  placeholder='{"summary":"answer","refs":"sources"}'
                  aria-label="JSON output schema"
                  className="mt-1 h-8 w-full rounded-lg border bg-background px-2 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            ) : null}

            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted/70"
              >
                {copied ? <Check className="size-3.5" strokeWidth={2} aria-hidden /> : <Clipboard className="size-3.5" strokeWidth={1.8} aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => void handleDownload()}
                className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted/70"
              >
                <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
                Download {formatMeta(format).ext}
              </button>
            </div>

            {showExport ? (
              <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-muted p-2 text-[11px] leading-snug whitespace-pre-wrap">
                {render(result, format, format === 'json' ? schema : undefined)}
              </pre>
            ) : null}
          </section>

          <section className="rounded-xl border bg-card p-3">
            <h3 className="mb-2 text-sm font-semibold">Ask a follow-up</h3>
            <ul className="mb-2 flex flex-col gap-2">
              {turns.map((turn, index) => (
                <li key={index} className="text-xs">
                  <p className="font-semibold">{turn.question}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{turn.answer}</p>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleAsk()
                }}
                placeholder="Only the sources already gathered…"
                aria-label="Follow-up question"
                className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => void handleAsk()}
                disabled={asking || draft.trim().length === 0 || result.sources.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {asking ? (
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
                ) : (
                  <Send className="size-3.5" strokeWidth={2} aria-hidden />
                )}
                Send
              </button>
            </div>
            {result.sources.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                This run kept no sources, so there is nothing to ask.
              </p>
            ) : null}
            {askError ? <p className="mt-2 text-[11px] text-red-600">{askError}</p> : null}
          </section>
        </>
      )}

      {runs.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Past research</h3>
          {runs.map((run) => (
            <div
              key={run.id}
              className="flex items-center gap-1 rounded-xl border bg-card transition-colors hover:bg-muted/50"
            >
              <button
                type="button"
                onClick={() => void openRun(run.id)}
                className={cn('min-w-0 flex-1 p-3 text-left', run.id === result?.id && 'bg-primary/5')}
              >
                <p className="truncate text-sm font-semibold">{run.question}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {run.depth} · {formatWhen(run.createdAt)} ·{' '}
                  {run.answer.includes('Contested') ? 'sources disagree' : 'one-sided'}
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  void deleteResearchRun(run.id).then(reloadRuns)
                  if (run.id === result?.id) research.show(null)
                }}
                aria-label={`Delete research on ${run.question}`}
                className="mr-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Trash2 className="size-4" strokeWidth={1.8} aria-hidden />
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}

function Cite({
  sourceId,
  citations,
}: {
  sourceId: string
  citations: ResearchResult['citations']
}) {
  const n = citations.find((entry) => entry.sourceId === sourceId)?.n
  if (n === undefined) return null
  return <span className="font-semibold text-primary">[{n}]</span>
}

function LineView({
  line,
  onHover,
}: {
  line: { kind: 'heading' | 'bullet' | 'text'; parts: SentencePart[] }
  onHover: (part: SentencePart) => void
}) {
  if (line.kind === 'heading') {
    return <h4 className="mt-2 text-sm font-bold">{line.parts[0]?.text}</h4>
  }
  const body = line.parts.map((part, index) => (
    <button
      key={index}
      type="button"
      onMouseEnter={() => onHover(part)}
      onFocus={() => onHover(part)}
      className={cn(
        'text-left',
        part.sources.length > 0 &&
          'underline decoration-dotted decoration-muted-foreground/60 underline-offset-2',
      )}
    >
      {emphasis(part.text)}{' '}
      {part.sources.length > 0 ? (
        <span className="text-[10px] font-semibold text-primary">
          {part.sources.map((n) => `[${n}]`).join('')}
        </span>
      ) : null}
    </button>
  ))
  if (line.kind === 'bullet') {
    return (
      <p className="flex gap-2">
        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/40" aria-hidden />
        <span className="min-w-0 flex-1">{body}</span>
      </p>
    )
  }
  return <p className="leading-relaxed">{body}</p>
}

function FeedRow({ event }: { event: ResearchEvent }) {
  switch (event.type) {
    case 'started':
      return <div className="font-semibold text-muted-foreground">Researching “{event.question}”</div>
    case 'plan':
      return (
        <div>
          ◇ planned {event.subQuestions.length} sub-questions:
          <span className="text-muted-foreground">
            {' '}
            {event.subQuestions.map((sub) => sub.question).join(' · ')}
          </span>
        </div>
      )
    case 'search':
      return <div className="text-muted-foreground">🔍 {event.query} — {event.hits} results</div>
    case 'open':
      return <div className="text-muted-foreground">↗ opened {clip(event.title)}</div>
    case 'scored':
      return (
        <div className={event.kept ? 'text-emerald-600' : 'text-muted-foreground'}>
          {event.kept ? '✓ kept' : '✗ dropped'} {event.relevance.toFixed(2)} — {clip(event.title)}
        </div>
      )
    case 'note':
      return (
        <div>
          ▣ note written · credibility {event.credibility.toFixed(2)} · {event.claims} claim
          {event.claims === 1 ? '' : 's'}
        </div>
      )
    case 'round':
      return <div className="mt-1 font-semibold">Gather round {event.round}</div>
    case 'synthesis':
      return <div className="mt-1 font-semibold">Synthesising {event.sources} sources…</div>
    case 'gaps':
      return (
        <div className="text-amber-700">
          {event.gaps.length === 0
            ? 'No gaps left — the corpus answers every sub-question.'
            : `Gaps: ${event.gaps.map(clip).join(' · ')}`}
        </div>
      )
    case 'done':
      return (
        <div className="mt-1 font-semibold">
          <Sparkle className="mr-1 inline size-3.5 text-primary" fill="currentColor" strokeWidth={0} aria-hidden />
          {event.result.sources.length} sources kept · {event.result.citations.length} citations ·{' '}
          <CostText usage={event.result} />
        </div>
      )
    case 'failed':
      return <div className="mt-1 font-semibold text-red-600">Failed: {event.error}</div>
  }
}

/** The answer is Markdown; only `**bold**` survives into the panel. */
function emphasis(text: string): ReactNode {
  const chunks = text.split(/\*\*(.+?)\*\*/g)
  if (chunks.length === 1) return text
  return chunks.map((chunk, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold">
        {chunk}
      </strong>
    ) : (
      chunk
    ),
  )
}

function clip(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}
