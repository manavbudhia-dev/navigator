import { describe, expect, it } from 'vitest'

import { assessRisk } from '@/safety/risk'

import { findElementInfo, parseElementLine, riskElementOf, riskTextOf } from './elementLines'

describe('parseElementLine', () => {
  it('parses an input line with attributes and empty text', () => {
    const info = parseElementLine('[3]<input id="email" type="email" placeholder="you@example.com"></input>')
    expect(info).not.toBeNull()
    expect(info!.index).toBe(3)
    expect(info!.tag).toBe('input')
    expect(info!.role).toBe('textbox')
    expect(info!.inputType).toBe('email')
    expect(info!.text).toBe('')
    expect(info!.attributes['placeholder']).toBe('you@example.com')
  })

  it('parses a button line with visible text', () => {
    const info = parseElementLine('[8]<button type="submit">Send</button>')
    expect(info!.role).toBe('button')
    expect(info!.text).toBe('Send')
  })

  it('maps roles for links, checkboxes and file inputs', () => {
    expect(parseElementLine('[0]<a href="/home">Home</a>')!.role).toBe('link')
    expect(parseElementLine('[5]<input id="agree" type="checkbox"></input>')!.role).toBe('checkbox')
    expect(parseElementLine('[6]<input type="file"></input>')!.role).toBe('file')
  })

  it('returns null for non-element lines', () => {
    expect(parseElementLine('URL: https://example.com')).toBeNull()
    expect(parseElementLine('### Heading')).toBeNull()
  })
})

describe('findElementInfo', () => {
  const lines = [
    'URL: https://example.com',
    '[0]<a href="/home">Home</a>',
    '[3]<input id="email" type="email"></input>',
  ]

  it('finds the line for an index', () => {
    expect(findElementInfo(lines, 3)!.attributes['id']).toBe('email')
    expect(findElementInfo(lines, 0)!.role).toBe('link')
  })

  it('returns null for unknown indices', () => {
    expect(findElementInfo(lines, 9)).toBeNull()
    expect(findElementInfo([], 0)).toBeNull()
  })
})

describe('riskElementOf', () => {
  it('reads the label out of the attributes, not only the text node', () => {
    const info = parseElementLine('[4]<button aria-label="Pay now" class="cta"></button>')!
    expect(riskTextOf(info)).toBe('Pay now')
    expect(riskElementOf(info)).toEqual({ role: 'button', tag: 'button', inputType: null, text: 'Pay now' })
  })

  it('puts the visible text first and joins the labelling attributes', () => {
    const info = parseElementLine('[1]<input name="card_cvc" placeholder="123">CVC</input>')!
    expect(riskTextOf(info)).toBe('CVC 123 card_cvc')
  })

  it('hands the risk scorer what it needs to hard-block an invisible payment button', () => {
    const info = findElementInfo(['[7]<button aria-label="Place order"></button>'], 7)!
    const assessment = assessRisk({ tool: 'click', kind: 'write', element: riskElementOf(info) })
    expect(assessment.hardBlock).toBe('payment')
  })

  it('still catches an OTP field that only says it in the field name', () => {
    const info = findElementInfo(['[2]<input name="otp_code"></input>'], 2)!
    const assessment = assessRisk({ tool: 'type_text', kind: 'write', element: riskElementOf(info) })
    expect(assessment.hardBlock).toBe('otp')
  })
})
