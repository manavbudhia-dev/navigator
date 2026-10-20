import type { ActRequest } from '@/types/actions'
import type { BoundingBox } from '@/types/pageState'

/**
 * chrome.debugger fallback (spec §4): dispatches trusted input events through
 * the DevTools protocol when the content script's synthetic events are
 * ignored by the page. Shows Chrome's "being debugged" infobar — that is the
 * honest cost of this capability.
 */

interface SendCommand {
  (target: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>): Promise<unknown>
}

const send: SendCommand = (target, method, params) =>
  chrome.debugger.sendCommand(target, method, params ?? {})

async function withDebugger<T>(tabId: number, run: () => Promise<T>): Promise<T> {
  const target: chrome.debugger.Debuggee = { tabId }
  await chrome.debugger.attach(target, '1.3')
  try {
    return await run()
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined)
  }
}

function center(bbox: BoundingBox): { x: number; y: number } {
  return { x: Math.round(bbox.x + bbox.width / 2), y: Math.round(bbox.y + bbox.height / 2) }
}

async function cdpClick(tabId: number, bbox: BoundingBox): Promise<string> {
  return withDebugger(tabId, async () => {
    const { x, y } = center(bbox)
    const point = { x, y, button: 'left' as const, clickCount: 1 }
    await send({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point })
    await send({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point })
    return `CDP clicked at (${x}, ${y}).`
  })
}

const KEY_MAP: Record<string, { key: string; code: string; vk: number }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
}

function keyEvents(target: chrome.debugger.Debuggee, special: { key: string; code: string; vk: number }): Promise<unknown> {
  return send(target, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: special.vk, nativeVirtualKeyCode: special.vk, key: special.key, code: special.code })
    .then(() => send(target, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: special.vk, nativeVirtualKeyCode: special.vk, key: special.key, code: special.code }))
}

async function cdpType(tabId: number, text: string, submit: boolean): Promise<string> {
  return withDebugger(tabId, async () => {
    const target: chrome.debugger.Debuggee = { tabId }
    for (const ch of text) {
      const special = KEY_MAP[ch]
      if (special) {
        await keyEvents(target, special)
      } else {
        await send(target, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch })
        await send(target, 'Input.dispatchKeyEvent', { type: 'keyUp', text: ch })
      }
    }
    if (submit) await keyEvents(target, KEY_MAP['Enter']!)
    return `CDP typed ${text.length} characters${submit ? ' and pressed Enter' : ''}.`
  })
}

async function cdpScroll(tabId: number, direction: 'down' | 'up', amountPx: number): Promise<string> {
  return withDebugger(tabId, async () => {
    await send({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 400,
      y: 300,
      deltaX: 0,
      deltaY: direction === 'down' ? amountPx : -amountPx,
    })
    return `CDP scrolled ${direction} by ${amountPx}px.`
  })
}

/**
 * Trusted-input path for one action. `bbox` is the remembered element box
 * (from the page-state snapshot); `text`/`submit` come from type requests.
 */
export async function cdpAct(
  tabId: number,
  request: ActRequest,
  bbox: BoundingBox | null,
  text?: string,
  submit?: boolean,
): Promise<string> {
  if (request.type === 'click') {
    if (!bbox) throw new Error('CDP click needs the element bounding box.')
    return cdpClick(tabId, bbox)
  }
  if (request.type === 'type') {
    if (text === undefined) throw new Error('CDP type needs the text.')
    return cdpType(tabId, text, submit ?? false)
  }
  return cdpScroll(tabId, request.direction, Math.round((request.amount ?? 0.8) * 600))
}
