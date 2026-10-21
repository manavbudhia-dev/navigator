// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { QUIET_MS, waitForInPage } from './waitFor'

import type { ActResult } from '@/types/actions'

/**
 * `wait_for` (spec §4) answers from inside the page, so these tests drive a real
 * DOM: one that already has the control, one that grows it later, and one that
 * never stops moving.
 *
 * jsdom has no layout and no `innerText`, so the two things the page code reads
 * are stubbed the way a laid-out browser would report them.
 */

function box(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    top: 0,
    left: 0,
    right: 20,
    bottom: 20,
    toJSON: () => ({}),
  } as DOMRect
}

HTMLElement.prototype.getBoundingClientRect = box
Object.defineProperty(HTMLElement.prototype, 'innerText', {
  configurable: true,
  get(this: HTMLElement) {
    return this.textContent ?? ''
  },
})

afterEach(() => {
  document.body.innerHTML = ''
})

function said(result: ActResult): string {
  if (!result.ok) throw new Error(result.error)
  return result.detail
}

describe('selector', () => {
  it('resolves as soon as the control is on the page', async () => {
    document.body.innerHTML = '<div id="late" style="width:10px;height:10px">Here</div>'
    const result = await waitForInPage('selector', '#late', 1000)
    expect(result.ok).toBe(true)
    expect(said(result)).toContain('#late')
  })

  it('waits for a control that arrives late', async () => {
    document.body.innerHTML = '<main></main>'
    const main = document.querySelector('main')!
    setTimeout(() => {
      const el = document.createElement('div')
      el.id = 'late'
      el.textContent = 'Arrived'
      main.append(el)
    }, 120)

    const result = await waitForInPage('selector', '#late', 2000)
    expect(result.ok).toBe(true)
  })

  it('times out when the control never shows up', async () => {
    document.body.innerHTML = '<main></main>'
    const result = await waitForInPage('selector', '#never', 200)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('Timed out after 200ms')
  })

  it('rejects a malformed selector instead of waiting on it', async () => {
    document.body.innerHTML = '<main></main>'
    const result = await waitForInPage('selector', '##', 200)
    expect(result.ok === false && result.error).toContain('not a valid CSS selector')
  })
})

describe('text', () => {
  it('finds text already rendered', async () => {
    document.body.innerHTML = '<p>Your booking is confirmed</p>'
    const result = await waitForInPage('text', 'booking is confirmed', 500)
    expect(result.ok).toBe(true)
  })

  it('times out on text that never appears', async () => {
    document.body.innerHTML = '<p>Nothing yet</p>'
    const result = await waitForInPage('text', 'invoice', 200)
    expect(result.ok).toBe(false)
  })
})

describe('quiet', () => {
  it('reports the page as settled once the DOM stops moving', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const result = await waitForInPage('quiet', '', QUIET_MS + 1500)
    expect(result.ok).toBe(true)
    expect(said(result)).toContain('stopped changing')
  })

  it('gives up while the page is still mutating', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = document.getElementById('root')!
    const timer = setInterval(() => root.append(document.createElement('span')), 20)
    const result = await waitForInPage('quiet', '', 300)
    clearInterval(timer)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('still mutating')
  })
})
