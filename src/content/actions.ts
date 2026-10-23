import { getSnapshot } from './perception/pageState'
import { resolveSelector } from './perception/resolve'
import { rectOf } from './perception/visibility'

import type { ActRequest, ActResult, ActTarget, UploadedFile } from '@/types/actions'
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

/**
 * How a typed value may be described in a log line. The detail string goes into
 * the timeline, the audit row and the model's transcript, so a secret keeps its
 * length and loses its content — the same way the keyboard fallback already
 * reports it.
 */
function typedWhat(el: Element, text: string): string {
  const name = `${el.getAttribute('name') ?? ''} ${el.getAttribute('id') ?? ''} ${el.getAttribute('aria-label') ?? ''}`
  const secret =
    (el instanceof HTMLInputElement && (el.type === 'password' || el.autocomplete === 'one-time-code')) ||
    /pass|secret|otp|one.?time|verification.?code|cvv|card/i.test(name)
  return secret ? `${text.length} characters (not shown)` : `"${text}"`
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
      detail: `Typed ${typedWhat(target, text)} into ${labelOf(el)} and submitted the form.`,
      target: targetOf(el),
    }
  }
  return { ok: true, detail: `Typed ${typedWhat(target, text)} into ${labelOf(el)}.`, target: targetOf(el) }
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

/** The control behind an index, re-resolved against the live DOM. */
type Located = { ok: true; el: IndexedElement; element: Element; strategy: string } | { ok: false; error: string }

function locate(index: number): Located {
  const el = findElement(index)
  if (!el) return { ok: false, error: `No element with index ${index}. Re-read the page.` }
  const resolved = resolveSelector(document, el.selector)
  if (!resolved) return { ok: false, error: `Element ${index} is gone from the page. Re-read it.` }
  return { ok: true, el, element: resolved.element, strategy: resolved.strategy }
}

function doHover(index: number): ActResult {
  const found = locate(index)
  if (!found.ok) return found
  found.element.scrollIntoView({ block: 'center', behavior: 'instant' })
  const rect = rectOf(found.element)
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
    button: 0,
  }
  found.element.dispatchEvent(new PointerEvent('pointerover', { ...init, pointerId: 1 }))
  found.element.dispatchEvent(new PointerEvent('pointerenter', { ...init, pointerId: 1 }))
  found.element.dispatchEvent(new MouseEvent('mouseover', init))
  found.element.dispatchEvent(new MouseEvent('mousemove', init))
  return {
    ok: true,
    detail: `Hovered ${labelOf(found.el)} — menus and tooltips it reveals are now on the page; re-read it.`,
    target: targetOf(found.el),
  }
}

interface KeyCombo {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

/** "ctrl+shift+k", "Enter", "a" — the shapes the spec's press_key accepts. */
export function parseKeyCombo(raw: string): KeyCombo {
  const parts = raw.split('+').map((part) => part.trim())
  const key = parts.at(-1) ?? ''
  // "ctrl+" or "a++" is a half-typed combo, not the Control key on its own.
  if (parts.length > 1 && parts.some((part) => part === '')) {
    return { key: '', ctrl: false, alt: false, shift: false, meta: false }
  }
  const mods = parts.slice(0, -1)
  return {
    key,
    ctrl: mods.some((mod) => /^(ctrl|control)$/i.test(mod)),
    alt: mods.some((mod) => /^alt$/i.test(mod)),
    shift: mods.some((mod) => /^shift$/i.test(mod)),
    meta: mods.some((mod) => /^(meta|cmd|command)$/i.test(mod)),
  }
}

function codeOf(key: string): string {
  if (key.length === 1) {
    if (key === ' ') return 'Space'
    if (/[0-9]/.test(key)) return `Digit${key}`
    return `Key${key.toUpperCase()}`
  }
  return key
}

function doPressKey(key: string, index?: number): ActResult {
  const combo = parseKeyCombo(key)
  if (combo.key === '') return { ok: false, error: `"${key}" is not a key or a combo like "ctrl+a".` }

  let target: Element = document.body
  let label = 'the page'
  let recorded: ActTarget | undefined
  if (index !== undefined) {
    const found = locate(index)
    if (!found.ok) return found
    target = found.element
    label = labelOf(found.el)
    recorded = targetOf(found.el)
    if (target instanceof HTMLElement || target instanceof SVGElement) target.focus()
  }

  const init: KeyboardEventInit = {
    key: combo.key,
    code: codeOf(combo.key),
    ctrlKey: combo.ctrl,
    altKey: combo.alt,
    shiftKey: combo.shift,
    metaKey: combo.meta,
    bubbles: true,
    cancelable: true,
  }
  target.dispatchEvent(new KeyboardEvent('keydown', init))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  return { ok: true, detail: `Pressed ${key} on ${label}.`, ...(recorded ? { target: recorded } : {}) }
}

/** Native <select> only; a custom listbox is a chain of clicks and says so. */
function doSelect(index: number, value: string): ActResult {
  const found = locate(index)
  if (!found.ok) return found
  const target = found.element
  if (!(target instanceof HTMLSelectElement)) {
    return {
      ok: false,
      error: `${labelOf(found.el)} is not a native dropdown. Read the page and click the option itself.`,
    }
  }
  const wanted = value.trim().toLowerCase()
  const option =
    Array.from(target.options).find((o) => o.text.trim() === value.trim()) ??
    Array.from(target.options).find((o) => o.text.trim().toLowerCase() === wanted) ??
    Array.from(target.options).find((o) => o.text.toLowerCase().includes(wanted)) ??
    Array.from(target.options).find((o) => o.value.toLowerCase() === wanted)
  if (!option) {
    const offered = Array.from(target.options).map((o) => o.text.trim() || o.value).slice(0, 12)
    return { ok: false, error: `No option matching "${value}" in ${labelOf(found.el)}. Offers: ${offered.join(', ')}.` }
  }
  target.value = option.value
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, detail: `Selected "${option.text.trim()}" in ${labelOf(found.el)}.`, target: targetOf(found.el) }
}

/** Tick or untick by clicking once when the state is already what we want. */
function doCheck(index: number, checked: boolean): ActResult {
  const found = locate(index)
  if (!found.ok) return found
  const target = found.element
  if (!(target instanceof HTMLInputElement) || (target.type !== 'checkbox' && target.type !== 'radio')) {
    return { ok: false, error: `${labelOf(found.el)} is not a checkbox or radio button. Use click.` }
  }
  if (target.type === 'radio' && !checked) {
    return {
      ok: false,
      error: `${labelOf(found.el)} is a radio button — it clears when another option is chosen, not by unticking.`,
    }
  }
  if (target.checked === checked) {
    return { ok: true, detail: `${labelOf(found.el)} was already ${checked ? 'checked' : 'unchecked'}.`, target: targetOf(found.el) }
  }
  const rect = rectOf(target)
  dispatchPointerSequence(target, rect.x + rect.width / 2, rect.y + rect.height / 2)
  if (target.checked !== checked) {
    // Sites that own the state can refuse the synthetic click; the audit trail
    // has to say what the page ended up showing, not what we asked for.
    target.checked = checked
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return { ok: true, detail: `${checked ? 'Checked' : 'Unchecked'} ${labelOf(found.el)}.`, target: targetOf(found.el) }
}

/** Chrome gives content scripts no way to read the user's disk, so the only
 *  file an upload can carry is one Navigator already holds as text. */
function buildFileList(files: File[]): FileList | null {
  try {
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    return transfer.files
  } catch {
    return null
  }
}

function doUpload(index: number, file: UploadedFile): ActResult {
  const found = locate(index)
  if (!found.ok) return found
  const target = found.element
  if (!(target instanceof HTMLInputElement) || target.type !== 'file') {
    return { ok: false, error: `${labelOf(found.el)} is not a file input.` }
  }
  const list = buildFileList([new File([file.text], file.name, { type: file.mime })])
  if (list === null) return { ok: false, error: 'This page cannot be handed a file. Ask the user to pick it.' }
  target.files = list
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
  return {
    ok: true,
    detail: `Attached ${file.name} (${file.text.length} characters of stored text) to ${labelOf(found.el)}. The file is not submitted yet.`,
    target: targetOf(found.el),
  }
}

function doDrag(fromIndex: number, toIndex: number): ActResult {
  const from = locate(fromIndex)
  if (!from.ok) return from
  const to = locate(toIndex)
  if (!to.ok) return to
  let transfer: DataTransfer
  try {
    transfer = new DataTransfer()
  } catch {
    return { ok: false, error: 'This page cannot accept a synthetic drag. Ask the user to drag it.' }
  }
  const fromRect = rectOf(from.element)
  const toRect = rectOf(to.element)
  const base = { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }
  from.element.dispatchEvent(new DragEvent('dragstart', { ...base, clientX: fromRect.x + 4, clientY: fromRect.y + 4 }))
  to.element.dispatchEvent(new DragEvent('dragenter', { ...base, clientX: toRect.x + 4, clientY: toRect.y + 4 }))
  to.element.dispatchEvent(new DragEvent('dragover', { ...base, clientX: toRect.x + 4, clientY: toRect.y + 4 }))
  to.element.dispatchEvent(new DragEvent('drop', { ...base, clientX: toRect.x + 4, clientY: toRect.y + 4 }))
  from.element.dispatchEvent(new DragEvent('dragend', base))
  return { ok: true, detail: `Dragged ${labelOf(from.el)} onto ${labelOf(to.el)}.`, target: targetOf(to.el) }
}

export function performAct(request: ActRequest): ActResult {
  switch (request.type) {
    case 'click':
      return doClick(request.index)
    case 'type':
      return doType(request.index, request.text, request.submit ?? false)
    case 'scroll':
      return doScroll(request.direction, request.amount ?? 0.8, request.index)
    case 'hover':
      return doHover(request.index)
    case 'press_key':
      return doPressKey(request.key, request.index)
    case 'select':
      return doSelect(request.index, request.value)
    case 'check':
      return doCheck(request.index, request.checked)
    case 'upload':
      return doUpload(request.index, request.file)
    case 'drag':
      return doDrag(request.fromIndex, request.toIndex)
  }
}
