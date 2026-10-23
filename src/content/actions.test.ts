// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseKeyCombo, performAct } from './actions'
import { buildPageState, getSnapshot } from './perception/pageState'
import { mockRects, rect } from './perception/testUtils'

import { DEFAULT_PAGE_STATE_OPTIONS } from '@/types/pageState'
import type { ActResult } from '@/types/actions'

/**
 * The Batch 11 verbs (spec §4). jsdom has no layout and no `DataTransfer`, so
 * the two paths that need them are asserted at their documented fallbacks;
 * `scripts/interaction-check.mjs` runs the same verbs in real Chromium.
 */

function setup(html: string): void {
  // jsdom has no layout engine, and no scrollIntoView to go with one.
  Element.prototype.scrollIntoView = () => undefined
  document.body.innerHTML = html
  const rects = new Map<Element, ReturnType<typeof rect>>()
  Array.from(document.querySelectorAll('*')).forEach((el, i) => {
    rects.set(el, rect(10, 10 + i * 30))
  })
  mockRects(rects)
  buildPageState(document, DEFAULT_PAGE_STATE_OPTIONS)
}

function indexOfId(id: string): number {
  const el = getSnapshot().find((item) => item.attributes['id'] === id)
  if (el === undefined) throw new Error(`The fixture indexes no #${id}`)
  return el.index
}

function said(result: ActResult): string {
  if (!result.ok) throw new Error(result.error)
  return result.detail
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('parseKeyCombo', () => {
  it('splits modifiers from the key', () => {
    expect(parseKeyCombo('ctrl+shift+k')).toMatchObject({ key: 'k', ctrl: true, shift: true, alt: false, meta: false })
    expect(parseKeyCombo('cmd+a')).toMatchObject({ key: 'a', meta: true })
    expect(parseKeyCombo('Enter')).toMatchObject({ key: 'Enter', ctrl: false })
    expect(parseKeyCombo(' + ').key).toBe('')
  })
})

describe('hover', () => {
  it('sends pointer and mouse over events to the control', () => {
    setup('<span id="pointer" style="cursor: pointer">Looks clickable</span>')
    const seen: string[] = []
    const el = document.getElementById('pointer')!
    el.addEventListener('pointerover', () => seen.push('pointerover'))
    el.addEventListener('mouseover', () => seen.push('mouseover'))

    const result = performAct({ type: 'hover', index: indexOfId('pointer') })
    expect(result.ok).toBe(true)
    expect(seen).toEqual(['pointerover', 'mouseover'])
    expect(result.ok && result.target?.label).toBe('Looks clickable')
  })
})

describe('press_key', () => {
  it('dispatches a combo on the element it is aimed at', () => {
    setup('<input id="email" type="email" />')
    const events: KeyboardEvent[] = []
    document.getElementById('email')!.addEventListener('keydown', (event) => {
      events.push(event as KeyboardEvent)
    })

    const result = performAct({ type: 'press_key', key: 'ctrl+a', index: indexOfId('email') })
    expect(result.ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]!.key).toBe('a')
    expect(events[0]!.code).toBe('KeyA')
    expect(events[0]!.ctrlKey).toBe(true)
  })

  it('falls back to the page when no element is given', () => {
    setup('<input id="email" type="email" />')
    const seen: string[] = []
    document.body.addEventListener('keydown', (event) => seen.push((event as KeyboardEvent).key))

    const result = performAct({ type: 'press_key', key: 'Escape' })
    expect(result.ok).toBe(true)
    expect(seen).toEqual(['Escape'])
    expect(said(result)).toContain('the page')
  })

  it('refuses a combo with no key in it', () => {
    setup('<input id="email" type="email" />')
    const result = performAct({ type: 'press_key', key: 'ctrl+' })
    expect(result).toEqual({ ok: false, error: '"ctrl+" is not a key or a combo like "ctrl+a".' })
  })
})

describe('select_option', () => {
  const HTML = '<select id="country"><option>India</option><option value="de">Germany</option></select>'

  it('matches the visible text exactly', () => {
    setup(HTML)
    const select = document.getElementById('country') as HTMLSelectElement
    let changes = 0
    select.addEventListener('change', () => changes += 1)

    const result = performAct({ type: 'select', index: indexOfId('country'), value: 'Germany' })
    expect(result.ok).toBe(true)
    expect(select.selectedIndex).toBe(1)
    expect(changes).toBe(1)
  })

  it('matches case-insensitively, then by substring, then by value', () => {
    setup(HTML)
    const select = document.getElementById('country') as HTMLSelectElement
    for (const value of ['germany', 'Germ', 'de']) {
      select.selectedIndex = 0
      expect(performAct({ type: 'select', index: indexOfId('country'), value }).ok).toBe(true)
      expect(select.value).toBe('de')
    }
  })

  it('lists what the dropdown actually offers', () => {
    setup(HTML)
    const result = performAct({ type: 'select', index: indexOfId('country'), value: 'France' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('India, Germany')
  })

  it('refuses a control that is not a native dropdown', () => {
    setup('<input id="email" type="email" />')
    const result = performAct({ type: 'select', index: indexOfId('email'), value: 'x' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not a native dropdown')
  })
})

describe('check', () => {
  it('ticks a checkbox and fires the framework events', () => {
    setup('<input id="agree" type="checkbox" />')
    const box = document.getElementById('agree') as HTMLInputElement
    const seen: string[] = []
    box.addEventListener('input', () => seen.push('input'))
    box.addEventListener('change', () => seen.push('change'))

    const result = performAct({ type: 'check', index: indexOfId('agree'), checked: true })
    expect(result.ok).toBe(true)
    expect(box.checked).toBe(true)
    expect(seen).toEqual(['input', 'change'])
  })

  it('says so when the control is already in the wanted state', () => {
    setup('<input id="agree" type="checkbox" />')
    const result = performAct({ type: 'check', index: indexOfId('agree'), checked: false })
    expect(result.ok).toBe(true)
    expect(said(result)).toContain('already unchecked')
  })

  it('will not untick a radio button', () => {
    setup('<input id="radio" type="radio" checked />')
    const result = performAct({ type: 'check', index: indexOfId('radio'), checked: false })
    expect(result.ok === false && result.error).toContain('radio button')
  })

  it('refuses a control that is not a checkbox', () => {
    setup('<input id="email" type="email" />')
    const result = performAct({ type: 'check', index: indexOfId('email'), checked: true })
    expect(result.ok === false && result.error).toContain('not a checkbox or radio')
  })
})

describe('upload', () => {
  const FILE = { name: 'resume.txt', mime: 'text/plain', text: 'A. Candidate' }

  it('refuses a control that is not a file input', () => {
    setup('<input id="email" type="email" />')
    const result = performAct({ type: 'upload', index: indexOfId('email'), file: FILE })
    expect(result.ok === false && result.error).toContain('not a file input')
  })

  it('tells the user to pick the file when the page cannot be handed one', () => {
    // jsdom has no DataTransfer, which is exactly the "this page refuses" path.
    setup('<input id="cv" type="file" />')
    const result = performAct({ type: 'upload', index: indexOfId('cv'), file: FILE })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('Ask the user to pick it')
  })

  it('reports a stale index before touching the page', () => {
    setup('<input id="cv" type="file" />')
    expect(performAct({ type: 'upload', index: 999, file: FILE }).ok).toBe(false)
  })
})

describe('drag_and_drop', () => {
  it('runs the drag event sequence across the two controls', () => {
    setup('<div id="src" draggable="true">Card</div><div id="dst" tabindex="0">Bin</div>')
    class FakeDataTransfer {
      items = { add: () => undefined }
      files: File[] = []
    }
    class FakeDragEvent extends MouseEvent {
      dataTransfer: unknown
      constructor(type: string, init: DragEventInit & { dataTransfer?: unknown }) {
        super(type, init)
        this.dataTransfer = init.dataTransfer
      }
    }
    const globals = globalThis as unknown as Record<string, unknown>
    globals['DataTransfer'] = FakeDataTransfer
    globals['DragEvent'] = FakeDragEvent

    const seen: string[] = []
    const src = document.getElementById('src')!
    const dst = document.getElementById('dst')!
    for (const [el, name] of [[src, 'src'], [dst, 'dst']] as const) {
      for (const type of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) {
        el.addEventListener(type, () => seen.push(`${name}:${type}`))
      }
    }

    const result = performAct({ type: 'drag', fromIndex: indexOfId('src'), toIndex: indexOfId('dst') })
    expect(result.ok).toBe(true)
    expect(seen).toEqual(['src:dragstart', 'dst:dragenter', 'dst:dragover', 'dst:drop', 'src:dragend'])
    expect(result.ok && result.target?.label).toBe('Bin')

    delete globals['DataTransfer']
    delete globals['DragEvent']
  })
})

describe('type', () => {
  it('keeps a secret out of the detail line but types it anyway', () => {
    setup('<input id="pw" type="password" name="password" />')
    const field = document.getElementById('pw') as HTMLInputElement

    const result = performAct({ type: 'type', index: indexOfId('pw'), text: 'hunter2' })
    expect(result.ok).toBe(true)
    expect(field.value).toBe('hunter2')
    expect(said(result)).toContain('7 characters (not shown)')
    expect(said(result)).not.toContain('hunter2')
  })

  it('names a credential-shaped field even when the input type says otherwise', () => {
    setup('<input id="otp" type="text" name="one_time_code" />')
    const result = performAct({ type: 'type', index: indexOfId('otp'), text: '482913' })
    expect(said(result)).toContain('6 characters (not shown)')
  })

  it('quotes an ordinary value', () => {
    setup('<input id="city" type="text" name="city" />')
    const result = performAct({ type: 'type', index: indexOfId('city'), text: 'Mumbai' })
    expect(said(result)).toContain('"Mumbai"')
  })
})

describe('stale indices', () => {
  it('asks for a re-read instead of acting on nothing', () => {
    setup('<span id="pointer" style="cursor: pointer">Looks clickable</span>')
    expect(performAct({ type: 'hover', index: 999 })).toEqual({
      ok: false,
      error: 'No element with index 999. Re-read the page.',
    })
    expect(performAct({ type: 'press_key', key: 'Enter', index: 999 }).ok).toBe(false)
    expect(performAct({ type: 'drag', fromIndex: 999, toIndex: 0 }).ok).toBe(false)
  })
})
