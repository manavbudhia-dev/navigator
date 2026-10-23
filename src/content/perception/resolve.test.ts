// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { collectInteractiveElements } from './indexer'
import { resolveSelector } from './resolve'
import { mockRects, rect, type FakeRect } from './testUtils'
import type { ElementSelector } from '@/types/pageState'

const VIEWPORT = { width: 1024, height: 768 }

/**
 * A selector whose precise strategies point at nothing, so the test exercises
 * the forgiving ones — which is where a wrong-element guess can happen.
 */
function selectorAt(overrides: Partial<ElementSelector>): ElementSelector {
  return {
    css: '#nothing-with-this-id',
    xpath: '/html/body/no-such-tag',
    textAnchor: 'Continue',
    bbox: rect(20, 40),
    tag: 'button',
    role: 'button',
    frameUrl: null,
    ...overrides,
  }
}

function snapshot() {
  return collectInteractiveElements(document, {
    includeOffViewport: true,
    maxElements: 400,
    viewport: VIEWPORT,
  })
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('resolveSelector', () => {
  it('resolves via css on an unchanged DOM', () => {
    document.body.innerHTML = '<div><button id="target">Submit</button></div>'
    const button = document.getElementById('target')!
    mockRects(new Map<Element, FakeRect>([[button, rect(20, 40)]]))

    const { elements } = snapshot()
    const result = resolveSelector(document, elements[0]!.selector)
    expect(result?.element).toBe(button)
    expect(result?.strategy).toBe('css')
  })

  it('falls back to text-anchor when a sibling insertion invalidates positional selectors', () => {
    document.body.innerHTML = '<div id="wrap"><button>Cancel</button><button>Submit</button></div>'
    const original = document.querySelectorAll('button')[1]!
    const sibling = document.querySelectorAll('button')[0]!
    mockRects(
      new Map<Element, FakeRect>([
        [original, rect(20, 40)],
        [sibling, rect(200, 40)],
      ]),
    )

    const { elements } = snapshot()
    const selector = elements[1]!.selector

    // A new button before the pair shifts nth-of-type(2) onto "Cancel".
    const wrap = document.getElementById('wrap')!
    const impostor = document.createElement('button')
    impostor.textContent = 'Pause'
    wrap.insertBefore(impostor, sibling)
    mockRects(
      new Map<Element, FakeRect>([
        [original, rect(20, 40)],
        [sibling, rect(200, 40)],
      ]),
    )

    const result = resolveSelector(document, selector)
    expect(result?.element).toBe(original)
    expect(result?.strategy).toBe('text-anchor')
  })

  it('falls back to bbox when positional selectors are stale and the label changed', () => {
    document.body.innerHTML = '<div id="wrap"><button>Cancel</button><button>Submit</button></div>'
    const original = document.querySelectorAll('button')[1]!
    const sibling = document.querySelectorAll('button')[0]!
    mockRects(
      new Map<Element, FakeRect>([
        [original, rect(20, 40)],
        [sibling, rect(200, 40)],
      ]),
    )

    const { elements } = snapshot()
    const selector = elements[1]!.selector

    const wrap = document.getElementById('wrap')!
    const impostor = document.createElement('button')
    impostor.textContent = 'Pause'
    wrap.insertBefore(impostor, sibling)
    original.textContent = 'Confirm order'
    mockRects(
      new Map<Element, FakeRect>([
        [original, rect(20, 40)],
        [sibling, rect(200, 40)],
      ]),
    )

    const result = resolveSelector(document, selector)
    expect(result?.element).toBe(original)
    expect(result?.strategy).toBe('bbox')
  })

  it('returns null when the element is gone', () => {
    document.body.innerHTML = '<div><button id="target">Submit</button></div>'
    const button = document.getElementById('target')!
    mockRects(new Map<Element, FakeRect>([[button, rect(20, 40)]]))

    const { elements } = snapshot()
    const selector = elements[0]!.selector

    document.body.innerHTML = '<div><p>Nothing here</p></div>'
    mockRects(new Map())

    expect(resolveSelector(document, selector)).toBeNull()
  })

  it('will not take a same-labelled control that is nowhere near the recorded spot', () => {
    // A "Continue" link in the footer is not the "Continue" button at the top
    // of a five-thousand-pixel page.
    const near = document.createElement('button')
    near.textContent = 'Continue'
    const far = document.createElement('button')
    far.textContent = 'Continue'
    document.body.append(near, far)
    mockRects(new Map<Element, FakeRect>([[near, rect(20, 40)], [far, rect(20, 5200)]]))

    expect(resolveSelector(document, selectorAt({ textAnchor: 'Continue', bbox: rect(20, 40) }))?.element).toBe(near)

    near.remove()
    expect(resolveSelector(document, selectorAt({ textAnchor: 'Continue', bbox: rect(20, 40) }))).toBeNull()
  })

  it('resolves a frame control in its own document, not the page that hosts it', () => {
    document.body.innerHTML = '<button id="top">Continue</button><iframe id="f1"></iframe>'
    const topButton = document.getElementById('top')!
    const frame = document.getElementById('f1') as HTMLIFrameElement
    const inner = frame.contentDocument!
    inner.body.innerHTML = '<button id="inside">Continue</button>'
    mockRects(
      new Map<Element, FakeRect>([
        [topButton, rect(20, 40)],
        [inner.getElementById('inside')!, rect(20, 40)],
      ]),
      [window, inner.defaultView as Window & typeof globalThis],
    )

    const selector = selectorAt({ textAnchor: 'Continue', bbox: rect(20, 40), frameUrl: inner.location.href })
    const result = resolveSelector(document, selector)
    expect(result?.element.id).toBe('inside')
  })

  it('refuses a frame that is gone, and a page with two frames on the same url', () => {
    document.body.innerHTML = '<button id="top">Continue</button><iframe id="f1"></iframe><iframe id="f2"></iframe>'
    const topButton = document.getElementById('top')!
    mockRects(new Map<Element, FakeRect>([[topButton, rect(20, 40)]]))

    const selector = selectorAt({ textAnchor: 'Continue', bbox: rect(20, 40) })
    // Both iframes are about:blank, so nothing says which one held the control.
    expect(resolveSelector(document, { ...selector, frameUrl: 'about:blank' })).toBeNull()
    expect(resolveSelector(document, { ...selector, frameUrl: 'https://gone.test/embed' })).toBeNull()
  })
})
