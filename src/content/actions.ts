import { getSnapshot } from './perception/pageState'
import { resolveSelector } from './perception/resolve'
import { rectOf } from './perception/visibility'

import type { ActRequest, ActResult, ActTarget } from '@/types/actions'
import type { IndexedElement } from '@/types/pageState'

/**
 * Action performer (spec §4): resolves an element index from the last
 * page-state snapshot and dispatches a full native event sequence.
 * Synthetic events are isTrusted:false — sites that ignore them get the
 * chrome.debugger CDP fallback, which the background triggers on `needsCdp`.
 */

function findElement(index: number): IndexedElement | null {
  return getSnapshot().find((el) => el.index === index) ?? null
}

function labelOf(el: IndexedElement): string {
  return el.text || el.attributes['aria-label'] || el.attributes['placeholder'] || `<${el.tag}>`
}

/** Remembered for recipes (spec §11): the control behind this action. */
function targetOf(el: IndexedElement): ActTarget {
  return { selector: el.selector, label: labelOf(el), role: el.role, inputType: el.attributes['type'] ?? null }
}

function dispatchPointerSequence(target: Element, x: number, y: number): void {
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
  }
  target.dispatchEvent(new PointerEvent('pointerover', init))
  target.dispatchEvent(new PointerEvent('pointerdown', init))
  target.dispatchEvent(new MouseEvent('mousedown', init))
  target.dispatchEvent(new PointerEvent('pointerup', init))
  target.dispatchEvent(new MouseEvent('mouseup', init))
  target.dispatchEvent(new MouseEvent('click', init))
}

function doClick(index: number): ActResult {
  const el = findElement(index)
  if (!el) return { ok: false, error: `No element with index ${index}. Re-read the page.` }

  const resolved = resolveSelector(document, el.selector)
  if (!resolved) {
    return { ok: false, error: `Element ${index} is gone from the page. Re-read it.` }
  }

  const target = resolved.element
  target.scrollIntoView({ block: 'center', behavior: 'instant' })
  const rect = rectOf(target)
  dispatchPointerSequence(target, rect.x + rect.width / 2, rect.y + rect.height / 2)

  return {
    ok: true,
    detail: `Clicked ${labelOf(el)} (resolved via ${resolved.strategy}).`,
    target: targetOf(el),
  }
}

/** Bypasses framework value-getters so React/Vue register the change. */
function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function doType(index: number, text: string, submit: boolean): ActResult {
  const el = findElement(index)
  if (!el) return { ok: false, error: `No element with index ${index}. Re-read the page.` }

  const resolved = resolveSelector(document, el.selector)
  if (!resolved) {
    return { ok: false, error: `Field ${index} is gone from the page. Re-read it.` }
  }

  const target = resolved.element
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    if (target instanceof HTMLSelectElement) {
      const option = Array.from(target.options).find((o) => o.text.trim() === text.trim())
      if (!option) {
        return { ok: false, error: `No option "${text}" in the dropdown ${index}.` }
      }
      target.value = option.value
      target.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, detail: `Selected "${text}" in ${labelOf(el)}.`, target: targetOf(el) }
    }
    target.scrollIntoView({ block: 'center', behavior: 'instant' })
    const rect = rectOf(target)
    dispatchPointerSequence(target, rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      ok: true,
      detail: `Focused ${labelOf(el)}; typing needs the keyboard fallback.`,
      fellBack: true,
      target: targetOf(el),
    }
  }

  target.focus()
  setNativeValue(target, text)

  if (submit && target.form) {
    target.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    return {
      ok: true,
      detail: `Typed "${text}" into ${labelOf(el)} and submitted the form.`,
      target: targetOf(el),
    }
  }
  return { ok: true, detail: `Typed "${text}" into ${labelOf(el)}.`, target: targetOf(el) }
}

function doScroll(direction: 'down' | 'up', amount: number, index?: number): ActResult {
  const viewportStep = Math.round(window.innerHeight * amount)
  const delta = direction === 'down' ? viewportStep : -viewportStep

  if (index === undefined) {
    window.scrollBy({ top: delta, behavior: 'instant' })
    return { ok: true, detail: `Scrolled ${direction} by ${Math.abs(delta)}px.` }
  }

  const el = findElement(index)
  const resolved = el ? resolveSelector(document, el.selector) : null
  if (resolved) {
    resolved.element.scrollBy({ top: delta, behavior: 'instant' })
    return { ok: true, detail: `Scrolled ${labelOf(el!)} ${direction} by ${Math.abs(delta)}px.` }
  }
  window.scrollBy({ top: delta, behavior: 'instant' })
  return { ok: true, detail: `Scrolled page ${direction} by ${Math.abs(delta)}px (element not scrollable).` }
}

export function performAct(request: ActRequest): ActResult {
  switch (request.type) {
    case 'click':
      return doClick(request.index)
    case 'type':
      return doType(request.index, request.text, request.submit ?? false)
    case 'scroll':
      return doScroll(request.direction, request.amount ?? 0.8, request.index)
  }
}
