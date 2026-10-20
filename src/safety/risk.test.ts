import { describe, expect, it } from 'vitest'

import { assessRisk } from './risk'

describe('assessRisk', () => {
  it('keeps reads safe', () => {
    const a = assessRisk({ tool: 'read_page', kind: 'read' })
    expect(a.level).toBe('safe')
    expect(a.hardBlock).toBeNull()
  })

  it('rates a plain click medium', () => {
    const a = assessRisk({
      tool: 'click',
      kind: 'write',
      element: { role: 'button', text: 'Show more' },
    })
    expect(a.level).toBe('medium')
    expect(a.hardBlock).toBeNull()
  })

  it('escalates login password fields to high without hard-blocking', () => {
    const a = assessRisk({
      tool: 'type_text',
      kind: 'write',
      element: { role: 'textbox', inputType: 'password', text: 'Password' },
    })
    expect(a.level).toBe('high')
    expect(a.hardBlock).toBeNull()
  })

  it('hard-blocks password creation', () => {
    const a = assessRisk({
      tool: 'type_text',
      kind: 'write',
      element: { role: 'textbox', inputType: 'password', text: 'Confirm new password' },
    })
    expect(a.hardBlock).toBe('password-create')
  })

  it('hard-blocks payment flows found in button text or URL', () => {
    const byText = assessRisk({
      tool: 'click',
      kind: 'write',
      element: { role: 'button', text: 'Proceed to Payment' },
    })
    expect(byText.hardBlock).toBe('payment')

    const byUrl = assessRisk({
      tool: 'click',
      kind: 'write',
      url: 'https://shop.example/checkout/pay',
      element: { role: 'button', text: 'Place order' },
    })
    expect(byUrl.hardBlock).toBe('payment')
  })

  it('hard-blocks legal consent, OTP and destructive confirmations', () => {
    expect(
      assessRisk({ tool: 'click', kind: 'write', element: { role: 'checkbox', text: 'I agree to the Terms of Service' } }).hardBlock,
    ).toBe('legal-consent')
    expect(
      assessRisk({ tool: 'type_text', kind: 'write', element: { role: 'textbox', text: 'Enter one-time code' } }).hardBlock,
    ).toBe('otp')
    expect(
      assessRisk({ tool: 'click', kind: 'write', element: { role: 'button', text: 'Delete account' } }).hardBlock,
    ).toBe('delete-or-confirm')
  })

  it('hard-blocks sensitive uploads but only rates plain uploads medium', () => {
    const sensitive = assessRisk({
      tool: 'click',
      kind: 'write',
      element: { role: 'file', text: 'Upload passport' },
    })
    expect(sensitive.hardBlock).toBe('sensitive-upload')

    const plain = assessRisk({
      tool: 'click',
      kind: 'write',
      element: { role: 'file', text: 'Attach receipt' },
    })
    expect(plain.hardBlock).toBeNull()
    expect(plain.level).toBe('medium')
  })

  it('escalates navigation to payment pages', () => {
    const a = assessRisk({ tool: 'navigate', kind: 'write', url: 'https://pay.example.com/checkout' })
    expect(a.hardBlock).toBe('payment')
  })

  it('falls back to medium for unknown write tools', () => {
    const a = assessRisk({ tool: 'mystery', kind: 'write' })
    expect(a.level).toBe('medium')
  })
})
