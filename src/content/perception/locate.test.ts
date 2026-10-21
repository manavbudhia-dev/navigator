// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { locateRecorded } from './locate'
import { collectInteractiveElements } from './indexer'
import { mockRects, rect, type FakeRect } from './testUtils'
import { cssPath } from './selectors'
import type { IndexedElement } from '@/types/pageState'

const VIEWPORT = { width: 1024, height: 768 }

function snapshot(): IndexedElement[] {
  return collectInteractiveElements(document, {
    includeOffViewport: true,
    maxElements: 400,
    viewport: VIEWPORT,
  }).elements
}

function measure(...elements: Element[]): void {
  const rects = new Map<Element, FakeRect>()
  elements.forEach((el, i) => {
    rects.set(el, rect(10, 40 + i * 30))
  })
  mockRects(rects)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('locateRecorded', () => {
  it('returns the new index when the page has grown above the control', () => {
    document.body.innerHTML = '<button id="apply">Apply now</button>'
    measure(document.getElementById('apply')!)
    const recorded = snapshot()[0]!.selector

    document.body.innerHTML =
      '<a href="#one">One</a><a href="#two">Two</a><button id="apply">Apply now</button>'
    measure(...Array.from(document.querySelectorAll('a, button')))
    const fresh = snapshot()

    expect(fresh.findIndex((el) => el.selector.css === cssPath(document.getElementById('apply')!))).toBe(2)
    expect(locateRecorded(document, fresh, recorded)).toBe(2)
  })

  it('returns null when the control is gone', () => {
    document.body.innerHTML = '<button id="apply">Apply now</button>'
    measure(document.getElementById('apply')!)
    const recorded = snapshot()[0]!.selector

    document.body.innerHTML = '<button id="other">Something else</button>'
    measure(document.getElementById('other')!)

    expect(locateRecorded(document, snapshot(), recorded)).toBeNull()
  })

  it('does not answer with a control of another kind at the same place', () => {
    document.body.innerHTML = '<button id="apply">Apply now</button>'
    measure(document.getElementById('apply')!)
    const recorded = snapshot()[0]!.selector

    // Same id, same box, now an input: replaying a click into it is not the
    // same action, so the recipe must fall through to the model instead.
    document.body.innerHTML = '<input id="apply" type="text">'
    measure(document.getElementById('apply')!)

    expect(locateRecorded(document, snapshot(), recorded)).toBeNull()
  })
})
