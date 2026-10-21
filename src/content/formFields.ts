import { resolveSelector } from './perception/resolve'
import type { IndexedElement } from '@/types/pageState'

/**
 * Form-field reading (spec §6). The classifier itself is pure and lives in
 * src/forms; this module only harvests the human hints a field carries —
 * <label>, aria, placeholder, nearby text — because that needs a real DOM.
 */

export interface FormFieldView {
  index: number
  tag: 'input' | 'select' | 'textarea'
  inputType: string
  role: string
  name: string
  id: string
  label: string
  placeholder: string
  ariaLabel: string
  nearbyText: string
  required: boolean
  value: string
  checked: boolean
  options: string[]
  accept: string
  pattern: string
  maxLength: number | null
}

function flat(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function textOf(node: Element | null): string {
  return node ? flat(node.textContent) : ''
}

/** jsdom has no CSS.escape; the manual fallback only needs to survive ids. */
function cssEscape(id: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(id)
    : id.replace(/[^a-zA-Z\d_-]/g, (char) => `\\${char}`)
}

function labelFor(el: Element): string {
  const ariaLabelledBy = el.getAttribute('aria-labelledby')
  if (ariaLabelledBy) {
    const doc = el.ownerDocument
    const parts = ariaLabelledBy
      .split(/\s+/)
      .map((id) => (doc ? textOf(doc.getElementById(id)) : ''))
      .filter((part) => part !== '')
    if (parts.length > 0) return parts.join(' ')
  }

  const id = el.getAttribute('id')
  if (id) {
    const label = el.ownerDocument?.querySelector(`label[for="${cssEscape(id)}"]`)
    const text = textOf(label)
    if (text !== '') return text
  }

  const wrapped = el.closest('label')
  const fromWrapper = textOf(wrapped)
  if (fromWrapper !== '') return fromWrapper

  return flat(el.getAttribute('aria-label'))
}

/** The text a human reads next to the field: previous sibling, legend or heading. */
function nearbyFor(el: Element): string {
  const parts: string[] = []
  let sibling = el.previousElementSibling
  for (let hops = 0; sibling && hops < 3; hops += 1) {
    const text = textOf(sibling)
    if (text !== '') parts.push(text)
    sibling = sibling.previousElementSibling
  }
  const fieldset = el.closest('fieldset')
  if (fieldset) parts.push(textOf(fieldset.querySelector('legend')))
  const row = el.closest('tr')
  if (row) parts.push(textOf(row.querySelector('th, td:first-child')))
  return flat(parts.join(' '))
}

function valueOf(el: Element): string {
  if (el instanceof HTMLInputElement) return el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : el.value
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value
  return ''
}

function optionsOf(el: Element): string[] {
  if (!(el instanceof HTMLSelectElement)) return []
  return Array.from(el.options)
    .map((option) => flat(option.textContent ?? option.value))
    .filter((text) => text !== '')
}

function toView(el: Element, index: number): FormFieldView {
  const input = el instanceof HTMLInputElement ? el : null
  const maxLength =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.maxLength : -1

  return {
    index,
    tag: el.tagName.toLowerCase() as FormFieldView['tag'],
    inputType: input?.type ?? (el.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'select-one'),
    role: el.getAttribute('role') ?? '',
    name: flat(el.getAttribute('name')),
    id: flat(el.getAttribute('id')),
    label: labelFor(el),
    placeholder: flat(el.getAttribute('placeholder')),
    ariaLabel: flat(el.getAttribute('aria-label')),
    nearbyText: nearbyFor(el),
    required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
    value: valueOf(el),
    checked: input !== null ? input.checked : false,
    options: optionsOf(el),
    accept: flat(input?.getAttribute('accept')),
    pattern: flat(input?.getAttribute('pattern')),
    maxLength: maxLength > 0 ? maxLength : null,
  }
}

const CONTROLS = 'input:not([type="hidden"]), textarea, select'

/**
 * Every form control on the page, tagged with its Page State index when the
 * indexer picked it up (-1 for controls the model never saw, e.g. a control
 * that appeared after the snapshot was taken).
 */
export function readFormFields(doc: Document, snapshot: readonly IndexedElement[]): FormFieldView[] {
  const indexByElement = new Map<Element, number>()
  for (const entry of snapshot) {
    const resolved = resolveSelector(doc, entry.selector)
    if (resolved) indexByElement.set(resolved.element, entry.index)
  }

  return Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(CONTROLS)).map(
    (el) => toView(el, indexByElement.get(el) ?? -1),
  )
}
