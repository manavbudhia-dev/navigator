import { useState } from 'react'
import { ShieldCheck, ShieldX } from 'lucide-react'

import { inExtension } from '@/lib/extension'
import type { SiteRule } from '@/safety/siteRules'
import type { BackgroundResponse } from '@/types/messages'

/**
 * What each list promises, in the words the card shows. The two lists mean
 * opposite things, so the copy cannot be shared between them.
 */
const RULE_COPY: Record<
  SiteRule,
  { icon: typeof ShieldCheck; label: (host: string) => string; done: (host: string) => string; title: string }
> = {
  allow: {
    icon: ShieldCheck,
    label: (host) => `Allow ${host} in Auto mode`,
    done: (host) => `${host} is allowed — Auto mode acts alone there from the next task.`,
    title: 'Auto mode stops asking for approval on this site in tasks you start from now on',
  },
  block: {
    icon: ShieldX,
    label: (host) => `Never act on ${host}`,
    done: (host) => `${host} is blocked — Navigator will not read or act on it in any mode.`,
    title: 'Navigator refuses every read and write on this site, in every mode, from the next task',
  },
}

/**
 * The "change the standing rule about this site" half of an approval card
 * (spec §9). It is not about this one step, so it sits apart from Allow once /
 * Deny and says when the rule takes effect: a run keeps the lists it started
 * with, so the answer is "next task", never "now".
 */
export function SiteRuleButton({ list, host }: { list: SiteRule; host: string }) {
  const [state, setState] = useState<{ busy: boolean; done: boolean; error: string | null }>({
    busy: false,
    done: false,
    error: null,
  })

  async function save(): Promise<void> {
    setState((prev) => ({ ...prev, busy: true, error: null }))
    let message: string | null = null
    try {
      const response = (await chrome.runtime.sendMessage({ kind: 'site-rule', list, host })) as
        | BackgroundResponse
        | undefined
      if (response === undefined) message = 'The extension did not answer. It may need reloading.'
      else if (!response.ok) message = response.error
      else if (!('sites' in response)) message = 'The worker did not confirm the change.'
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause)
    }
    setState({ busy: false, done: message === null, error: message })
  }

  const copy = RULE_COPY[list]
  const Icon = copy.icon

  if (state.done) {
    return (
      <p
        className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"
        role="status"
        data-site-allowed={list === 'allow' ? host : undefined}
        data-site-blocked={list === 'block' ? host : undefined}
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
        {copy.done(host)}
      </p>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void save()}
        disabled={!inExtension || state.busy}
        title={copy.title}
        className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
      >
        <Icon className="size-3.5" strokeWidth={1.8} aria-hidden />
        {state.busy ? 'Saving…' : copy.label(host)}
      </button>
      {state.error === null ? null : (
        <span className="text-xs text-red-600 dark:text-red-400" role="alert">
          {state.error}
        </span>
      )}
    </span>
  )
}
