import { useState } from 'react'
import { CircleCheck, CircleX, PlugZap, Play } from 'lucide-react'

import { cn } from '@/lib/utils'
import { AGENT_MODES, MODE_LABELS, type AgentMode } from '@/types/agent'
import type { BackgroundMessage, BackgroundResponse, PageMeta } from '@/types/messages'

type Connection =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; meta: PageMeta }
  | { state: 'error'; error: string }

export function AgentPanel() {
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<AgentMode>('copilot')
  const [connection, setConnection] = useState<Connection>({ state: 'idle' })

  async function testConnection() {
    setConnection({ state: 'checking' })
    try {
      const message: BackgroundMessage = { kind: 'ping-active-tab' }
      const response = (await chrome.runtime.sendMessage(message)) as BackgroundResponse
      setConnection(response.ok ? { state: 'ok', meta: response.meta } : { state: 'error', error: response.error })
    } catch (error) {
      setConnection({
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <section className="flex flex-col gap-2">
        <label htmlFor="goal" className="text-xs font-medium text-muted-foreground">
          What should I do?
        </label>
        <textarea
          id="goal"
          rows={3}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder='e.g. "Find 3 chrome extension boilerplates on GitHub and compare their stars"'
          className="w-full resize-y rounded-md border bg-card px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="flex items-center gap-2">
          <label htmlFor="mode" className="sr-only">
            Agent mode
          </label>
          <select
            id="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as AgentMode)}
            className="rounded-md border bg-card px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {AGENT_MODES.map((value) => (
              <option key={value} value={value}>
                {MODE_LABELS[value]}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled
            title="Agent loop arrives in Batch 5"
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium',
              'bg-primary text-primary-foreground opacity-50',
            )}
          >
            <Play className="size-3.5" aria-hidden />
            Run
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-md border bg-card p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold">Extension wiring check</h2>
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={connection.state === 'checking'}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <PlugZap className="size-3.5" aria-hidden />
            {connection.state === 'checking' ? 'Checking…' : 'Test page connection'}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Proves side panel → service worker → content script messaging works on the active tab.
        </p>

        {connection.state === 'ok' ? (
          <div className="flex flex-col gap-1 text-xs" role="status">
            <p className="flex items-center gap-1.5 font-medium text-green-600 dark:text-green-400">
              <CircleCheck className="size-3.5" aria-hidden /> Connected
            </p>
            <p className="truncate" title={connection.meta.title}>
              <span className="text-muted-foreground">Title:</span> {connection.meta.title}
            </p>
            <p className="truncate" title={connection.meta.url}>
              <span className="text-muted-foreground">URL:</span> {connection.meta.url}
            </p>
            <p className="text-muted-foreground">
              Scrolled {connection.meta.scrollPercent}% · page {connection.meta.pageHeightPx}px ·
              viewport {connection.meta.viewport.width}×{connection.meta.viewport.height}
            </p>
          </div>
        ) : null}

        {connection.state === 'error' ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
            <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="break-words">{connection.error}</span>
          </p>
        ) : null}
      </section>
    </div>
  )
}
