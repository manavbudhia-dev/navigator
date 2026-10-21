/**
 * Messages exchanged between the side panel, background service worker and
 * content scripts. Keep this union narrow: anything an LLM can trigger goes
 * through the tool registry instead, not through ad-hoc messages.
 */

import type { ActRequest, ActResult } from './actions'
import type { AgentMode } from './agent'
import type { FormFieldView } from '@/content/formFields'
import type { ArticlePayload, ResearchDepth } from '@/research/types'
import type { PageState } from './pageState'
import type { VaultReply, VaultRequest } from './vault'

export type PageMeta = {
  url: string
  title: string
  readyState: DocumentReadyState
  scrollPercent: number
  pageHeightPx: number
  viewport: { width: number; height: number }
}

/** side panel -> background */
export type BackgroundMessage =
  | { kind: 'ping-active-tab' }
  | { kind: 'get-page-state-active-tab'; includeOffViewport?: boolean }
  | { kind: 'act-active-tab'; action: ActRequest }
  | { kind: 'run-task'; goal: string; mode: AgentMode }
  | { kind: 'stop-task' }
  | { kind: 'approve-action'; id: string; approved: boolean }
  | { kind: 'answer-question'; id: string; answer: string }
  | { kind: 'set-overlay'; visible?: boolean; highlightIndex?: number; review?: number[] }
  | { kind: 'get-form-fields-active-tab' }
  | { kind: 'vault'; request: VaultRequest }
  | { kind: 'run-research'; question: string; depth: ResearchDepth }
  | { kind: 'stop-research' }
  | { kind: 'research-followup'; runId: string; question: string }

export type BackgroundResponse =
  | { ok: true; meta: PageMeta }
  | { ok: true; pageState: PageState }
  | { ok: true; fields: FormFieldView[] }
  | { ok: true; vault: VaultReply }
  | { ok: true; answer: string }
  | { ok: true; accepted: boolean; error?: string }
  | { ok: false; error: string }
  | ActResult

/** background -> content script */
export type ContentMessage =
  | { kind: 'ping' }
  | { kind: 'get-page-state'; includeOffViewport?: boolean }
  | { kind: 'act'; action: ActRequest }
  | { kind: 'overlay'; visible?: boolean; highlightIndex?: number; review?: number[] }
  | { kind: 'get-form-fields' }
  | { kind: 'get-article' }

export type ContentResponse =
  | { ok: true; meta: PageMeta }
  | { ok: true; pageState: PageState }
  | { ok: true; fields: FormFieldView[] }
  | { ok: true; article: ArticlePayload }
  | ActResult

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'ping-active-tab' ||
      value.kind === 'get-page-state-active-tab' ||
      value.kind === 'act-active-tab' ||
      value.kind === 'run-task' ||
      value.kind === 'stop-task' ||
      value.kind === 'approve-action' ||
      value.kind === 'answer-question' ||
      value.kind === 'set-overlay' ||
      value.kind === 'get-form-fields-active-tab' ||
      value.kind === 'vault' ||
      value.kind === 'run-research' ||
      value.kind === 'stop-research' ||
      value.kind === 'research-followup')
  )
}

export function isContentMessage(value: unknown): value is ContentMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'ping' ||
      value.kind === 'get-page-state' ||
      value.kind === 'act' ||
      value.kind === 'overlay' ||
      value.kind === 'get-form-fields' ||
      value.kind === 'get-article')
  )
}
