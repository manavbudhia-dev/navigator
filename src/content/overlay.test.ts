// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { highlightElement, setOverlay } from './overlay'
import { buildPageState } from './perception/pageState'
import { mockRects, rect, type FakeRect } from './perception/testUtils'
import { DEFAULT_PAGE_STATE_OPTIONS } from '@/types/pageState'

const LAYER = 'navigator-overlay'

function snapshot(): void {
  buildPageState(document, DEFAULT_PAGE_STATE_OPTIONS)
}

function boxes(): HTMLElement[] {
  const layer = document.getElementById(LAYER)
  return layer ? Array.from(layer.querySelectorAll<HTMLElement>('.nav-box')) : []
}

afterEach(() => {
  document.getElementById(LAYER)?.remove()
  document.body.innerHTML = ''
  buildPageState(document, DEFAULT_PAGE_STATE_OPTIONS)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('setOverlay', () => {
  it('draws one numbered box per on-screen element', () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button><button id="c">C</button>'
    mockRects(
      new Map<Element, FakeRect>([
        [document.getElementById('a')!, rect(10, 10)],
        [document.getElementById('b')!, rect(10, 500)],
        [document.getElementById('c')!, rect(10, 4000)],
      ]),
    )
    snapshot()

    const result = setOverlay(true)
    expect(result.ok).toBe(true)
    expect(boxes().map((box) => box.querySelector('.nav-tag')?.textContent)).toEqual(['0', '1'])
    expect(boxes()[0]!.style.left).toBe('10px')
  })

  it('rebuilds the snapshot when none exists yet', () => {
    document.body.innerHTML = '<button id="solo">Only</button>'
    mockRects(new Map<Element, FakeRect>([[document.getElementById('solo')!, rect(0, 0)]]))

    expect(setOverlay(true).ok).toBe(true)
    expect(boxes()).toHaveLength(1)
  })

  it('removes the layer when hidden', () => {
    document.body.innerHTML = '<button id="solo">Only</button>'
    mockRects(new Map<Element, FakeRect>([[document.getElementById('solo')!, rect(0, 0)]]))
    setOverlay(true)
    expect(boxes()).toHaveLength(1)

    expect(setOverlay(false)).toEqual({ ok: true, detail: 'Overlay off' })
    expect(document.getElementById(LAYER)).toBeNull()
  })

  it('refuses pages where nothing is visible', () => {
    document.body.innerHTML = '<p>no controls</p>'
    snapshot()
    expect(setOverlay(true)).toEqual({
      ok: false,
      error: 'No visible elements to highlight on this page.',
    })
  })
})

describe('highlightElement', () => {
  it('pulses the remembered element and clears itself', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button id="one">One</button><button id="two">Two</button>'
    mockRects(
      new Map<Element, FakeRect>([
        [document.getElementById('one')!, rect(30, 40)],
        [document.getElementById('two')!, rect(30, 90)],
      ]),
    )
    snapshot()

    const result = highlightElement(1)
    expect(result.ok).toBe(true)
    const pulse = document.querySelector('.nav-pulse') as HTMLElement
    expect(pulse.style.left).toBe('28px')
    expect(pulse.style.top).toBe('88px')

    vi.advanceTimersByTime(1500)
    expect(document.querySelector('.nav-pulse')).toBeNull()
  })

  it('reports an index that was never snapshotted', () => {
    document.body.innerHTML = '<button id="one">One</button>'
    mockRects(new Map<Element, FakeRect>([[document.getElementById('one')!, rect(0, 0)]]))
    snapshot()

    expect(highlightElement(7)).toEqual({ ok: false, error: 'No snapshot element with index 7.' })
  })

  it('reports an element the page removed', () => {
    document.body.innerHTML = '<button id="one">One</button>'
    const button = document.getElementById('one')!
    mockRects(new Map<Element, FakeRect>([[button, rect(0, 0)]]))
    snapshot()
    button.remove()
    vi.restoreAllMocks()

    expect(highlightElement(0).ok).toBe(false)
  })
})
