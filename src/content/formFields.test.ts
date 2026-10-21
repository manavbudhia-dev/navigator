// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readFormFields } from './formFields'
import { buildPageState, getSnapshot } from './perception/pageState'
import { mockRects, rect, type FakeRect } from './perception/testUtils'
import { DEFAULT_PAGE_STATE_OPTIONS } from '@/types/pageState'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function mockAllRects(): void {
  const controls = Array.from(document.querySelectorAll('input, select, textarea'))
  mockRects(new Map<Element, FakeRect>(controls.map((el, i) => [el, rect(0, i * 40)])))
}

function read(): ReturnType<typeof readFormFields> {
  buildPageState(document, DEFAULT_PAGE_STATE_OPTIONS)
  return readFormFields(document, getSnapshot())
}

describe('readFormFields', () => {
  it('harvests every hint a classifier can use', () => {
    document.body.innerHTML = `
      <form>
        <label for="mail">Email address</label>
        <input id="mail" name="user_email" type="email" placeholder="you@example.com" required />
      </form>`
    mockAllRects()

    const [field] = read()
    expect(field?.label).toBe('Email address')
    expect(field?.name).toBe('user_email')
    expect(field?.inputType).toBe('email')
    expect(field?.required).toBe(true)
    expect(field?.index).toBeGreaterThanOrEqual(0)
  })

  it('reads a wrapping label and aria-labelledby', () => {
    document.body.innerHTML = `
      <label>First name <input name="first" /></label>
      <p id="cap">Last name</p>
      <input id="last" aria-labelledby="cap" />`
    mockAllRects()

    const fields = read()
    expect(fields[0]?.label).toBe('First name')
    expect(fields[1]?.label).toBe('Last name')
  })

  it('collects the text floating next to an unlabelled control', () => {
    document.body.innerHTML = `
      <div>
        <span>Years of experience</span>
        <input name="exp" />
      </div>`
    mockAllRects()

    expect(read()[0]?.nearbyText).toContain('Years of experience')
  })

  it('keeps dropdown options and input limits', () => {
    document.body.innerHTML = `
      <select id="country"><option value="">Select…</option><option>India</option><option>Germany</option></select>
      <input id="nick" maxlength="12" pattern="[a-z]+" />
      <textarea id="bio"></textarea>`
    mockAllRects()

    const [country, nick, bio] = read()
    expect(country?.tag).toBe('select')
    expect(country?.inputType).toBe('select-one')
    expect(country?.options).toEqual(['Select…', 'India', 'Germany'])
    expect(nick?.maxLength).toBe(12)
    expect(nick?.pattern).toBe('[a-z]+')
    expect(bio?.inputType).toBe('textarea')
    expect(bio?.maxLength).toBeNull()
  })

  it('reports the current value and checkbox state so filled fields are skipped', () => {
    document.body.innerHTML = `
      <input id="a" value="already" />
      <input id="b" type="checkbox" checked />`
    mockAllRects()

    const [filled, box] = read()
    expect(filled?.value).toBe('already')
    expect(box?.checked).toBe(true)
    expect(box?.value).toBe('true')
  })

  it('gives -1 to a control that appeared after the snapshot', () => {
    document.body.innerHTML = '<input id="a" />'
    mockAllRects()
    buildPageState(document, DEFAULT_PAGE_STATE_OPTIONS)

    const late = document.createElement('input')
    late.id = 'late'
    document.body.append(late)

    const fields = readFormFields(document, getSnapshot())
    expect(fields.map((f) => [f.id, f.index])).toEqual([
      ['a', 0],
      ['late', -1],
    ])
  })

  it('ignores hidden inputs', () => {
    document.body.innerHTML = '<input type="hidden" name="token" value="x" /><input id="visible" />'
    mockAllRects()

    expect(read().map((f) => f.id)).toEqual(['visible'])
  })
})
