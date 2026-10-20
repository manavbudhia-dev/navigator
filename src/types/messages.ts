/**
 * Messages exchanged between the side panel, background service worker and
 * content scripts. Keep this union narrow: anything an LLM can trigger goes
 * through the tool registry instead, not through ad-hoc messages.
 */

export type PageMeta = {
  url: string
  title: string
  readyState: DocumentReadyState
  scrollPercent: number
  pageHeightPx: number
  viewport: { width: number; height: number }
}

/** side panel -> background */
export type BackgroundMessage = { kind: 'ping-active-tab' }

export type BackgroundResponse =
  | { ok: true; meta: PageMeta }
  | { ok: false; error: string }

/** background -> content script */
export type ContentMessage = { kind: 'ping' }

export type ContentResponse = { ok: true; meta: PageMeta }

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'ping-active-tab'
  )
}

export function isContentMessage(value: unknown): value is ContentMessage {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'ping'
  )
}
