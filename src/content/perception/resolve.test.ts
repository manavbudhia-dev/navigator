// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { collectInteractiveElements } from './indexer'
import { resolveSelector } from './resolve'
import { mockRects, rect, type FakeRect } from './testUtils'

const VIEWPORT = { width: 1024, height: 768 }

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
})
