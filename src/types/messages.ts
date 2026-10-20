/**
 * Messages exchanged between the side panel, background service worker and
 * content scripts. Keep this union narrow: anything an LLM can trigger goes
 * through the tool registry instead, not through ad-hoc messages.
 */

import type { ActRequest, ActResult } from './actions'
import type { PageState } from './pageState'

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

export type BackgroundResponse =
  | { ok: true; meta: PageMeta }
  | { ok: true; pageState: PageState }
  | { ok: false; error: string }
  | ActResult

/** background -> content script */
export type ContentMessage =
  | { kind: 'ping' }
  | { kind: 'get-page-state'; includeOffViewport?: boolean }
  | { kind: 'act'; action: ActRequest }

export type ContentResponse =
  | { ok: true; meta: PageMeta }
  | { ok: true; pageState: PageState }
  | ActResult

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'ping-active-tab' ||
      value.kind === 'get-page-state-active-tab' ||
      value.kind === 'act-active-tab')
  )
}

export function isContentMessage(value: unknown): value is ContentMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'ping' || value.kind === 'get-page-state' || value.kind === 'act')
  )
}
