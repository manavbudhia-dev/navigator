import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'

import { inExtension } from '@/lib/extension'
import type { BackgroundResponse } from '@/types/messages'

/**
 * The "let this site through" half of an approval card (spec §9). It changes a
 * standing rule, not this one step, so it sits apart from Allow once / Deny and
 * says when the rule takes effect: a run keeps the list it started with.
 */
export function AllowSiteButton({ host }: { host: string }) {
  const [state, setState] = useState<{ busy: boolean; done: boolean; error: string | null }>({
    busy: false,
    done: false,
    error: null,
  })

  async function allow(): Promise<void> {
    setState((prev) => ({ ...prev, busy: true, error: null }))
    let message: string | null = null
    try {
      const response = (await chrome.runtime.sendMessage({ kind: 'allow-site', host })) as
        | BackgroundResponse
        | undefined
      if (response === undefined) message = 'The extension did not answer. It may need reloading.'
      else if (!response.ok) message = response.error
      else if (!('allowlist' in response)) message = 'The worker did not confirm the change.'
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause)
    }
    setState({ busy: false, done: message === null, error: message })
  }

  if (state.done) {
    return (
      <p
        className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"
        role="status"
        data-site-allowed={host}
      >
        <ShieldCheck className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
        {host} is allowed — Auto mode acts alone there from the next task.
      </p>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void allow()}
        disabled={!inExtension || state.busy}
        title="Auto mode stops asking for approval on this site in tasks you start from now on"
        className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
      >
        <ShieldCheck className="size-3.5" strokeWidth={1.8} aria-hidden />
        {state.busy ? 'Saving…' : `Allow ${host} in Auto mode`}
      </button>
      {state.error === null ? null : (
        <span className="text-xs text-red-600 dark:text-red-400" role="alert">
          {state.error}
        </span>
      )}
    </span>
  )
}
