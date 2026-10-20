// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { collectInteractiveElements, serializeElement } from './indexer'
import { mockRects, rect, type FakeRect } from './testUtils'

const VIEWPORT = { width: 1024, height: 768 }

function collect(options?: Partial<Parameters<typeof collectInteractiveElements>[1]>) {
  return collectInteractiveElements(document, {
    includeOffViewport: true,
    maxElements: 400,
    viewport: VIEWPORT,
    ...options,
  })
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('collectInteractiveElements', () => {
  it('indexes interactive elements in document order with semantic roles', () => {
    document.body.innerHTML = `
      <button id="b">Search</button>
      <a href="/x" id="a">Docs</a>
      <input id="i" type="text" placeholder="Query" />
      <select id="s"><option>One</option></select>
      <textarea id="t"></textarea>
      <div role="button" id="rb">Fake</div>
      <div contenteditable="true" id="ce"></div>
      <span id="cp" style="cursor:pointer">Clickable</span>
      <p id="plain">Not interactive</p>
    `
    const rects = new Map<Element, FakeRect>()
    for (const id of ['b', 'a', 'i', 's', 't', 'rb', 'ce', 'cp', 'plain']) {
      const el = document.getElementById(id)
      if (el) rects.set(el, rect(10, 10))
    }
    mockRects(rects)

    const { elements } = collect()
    expect(elements.map((el) => el.role)).toEqual([
      'button',
      'link',
      'textbox',
      'combobox',
      'textbox',
      'button',
      'textbox',
      'clickable',
    ])
    expect(elements.map((el) => el.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('filters hidden, zero-size, aria-hidden, disabled and hidden-type elements', () => {
    document.body.innerHTML = `
      <button id="ok">Visible</button>
      <button id="display" style="display:none">Nope</button>
      <button id="invisible" style="visibility:hidden">Nope</button>
      <button id="transparent" style="opacity:0">Nope</button>
      <button id="zero">Nope</button>
      <div aria-hidden="true"><button id="hidden">Nope</button></div>
      <button id="disabled" disabled>Nope</button>
      <input id="hiddeninput" type="hidden" />
    `
    const rects = new Map<Element, FakeRect>()
    for (const id of ['ok', 'display', 'invisible', 'transparent', 'hidden', 'disabled', 'hiddeninput']) {
      const el = document.getElementById(id)
      if (el) rects.set(el, rect(10, 10))
    }
    mockRects(rects)

    const { elements } = collect()
    expect(elements.map((el) => el.attributes.id)).toEqual(['ok'])
  })

  it('marks off-viewport elements and can exclude them', () => {
    document.body.innerHTML = `
      <button id="near">Near</button>
      <button id="far">Far</button>
    `
    const rects = new Map<Element, FakeRect>()
    const near = document.getElementById('near')!
    const far = document.getElementById('far')!
    rects.set(near, rect(10, 10))
    rects.set(far, rect(10, 5000))
    mockRects(rects)

    const withOff = collect()
    expect(withOff.elements.map((el) => el.inViewport)).toEqual([true, false])

    const viewportOnly = collect({ includeOffViewport: false })
    expect(viewportOnly.elements.map((el) => el.attributes.id)).toEqual(['near'])
  })

  it('traverses shadow roots and same-origin iframes', () => {
    document.body.innerHTML = '<div id="host"></div><iframe id="frame"></iframe>'
    const host = document.getElementById('host')!
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<button id="shadowbtn">Shadow</button>'

    const frame = document.getElementById('frame') as HTMLIFrameElement
    const frameDoc = frame.contentDocument
    expect(frameDoc).not.toBeNull()
    frameDoc!.body.innerHTML = '<button id="framebtn">Frame</button>'

    const rects = new Map<Element, FakeRect>()
    rects.set(shadow.querySelector('button')!, rect(10, 10))
    rects.set(frameDoc!.querySelector('button')!, rect(10, 10))
    mockRects(rects, [window, frameDoc!.defaultView!])

    const { elements } = collect()
    expect(elements.map((el) => el.text)).toEqual(['Shadow', 'Frame'])
    expect(elements[1]?.selector.frameUrl).not.toBeNull()
  })

  it('stops at the element cap', () => {
    document.body.innerHTML = Array.from({ length: 10 }, (_, i) => `<button id="b${i}">B${i}</button>`).join('')
    const rects = new Map<Element, FakeRect>()
    for (let i = 0; i < 10; i += 1) {
      const el = document.getElementById(`b${i}`)
      if (el) rects.set(el, rect(10, 10))
    }
    mockRects(rects)

    const { elements, hitCap } = collect({ maxElements: 4 })
    expect(elements).toHaveLength(4)
    expect(hitCap).toBe(true)
  })
})

describe('serializeElement', () => {
  it('matches the spec line format', () => {
    document.body.innerHTML = '<button aria-label="Search" class="hdr-btn">Search</button>'
    const button = document.querySelector('button')!
    mockRects(new Map([[button, rect(10, 10)]]))

    const { elements } = collect()
    expect(serializeElement(elements[0]!)).toBe(
      '[0]<button aria-label="Search" class="hdr-btn">Search</button>',
    )
  })
})
