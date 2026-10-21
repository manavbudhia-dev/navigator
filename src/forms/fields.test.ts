import { describe, expect, it } from 'vitest'

import { BLOCKED_REASONS, classifyField, isBlockedKind } from './fields'
import type { FormFieldView } from '@/content/formFields'

function field(overrides: Partial<FormFieldView> = {}): FormFieldView {
  return {
    index: 0,
    tag: 'input',
    inputType: 'text',
    role: '',
    name: '',
    id: '',
    label: '',
    placeholder: '',
    ariaLabel: '',
    nearbyText: '',
    required: false,
    value: '',
    checked: false,
    options: [],
    accept: '',
    pattern: '',
    maxLength: null,
    ...overrides,
  }
}

function kind(label: string, overrides: Partial<FormFieldView> = {}) {
  return classifyField(field({ label, ...overrides }))
}

describe('classifyField', () => {
  it('reads the obvious vocabulary from the label', () => {
    expect(kind('First name').kind).toBe('firstName')
    expect(kind('Last name').kind).toBe('lastName')
    expect(kind('Phone number').kind).toBe('phone')
    expect(kind('Date of birth').kind).toBe('dob')
    expect(kind('Postal code').kind).toBe('postalCode')
    expect(kind('City').kind).toBe('city')
    expect(kind('LinkedIn profile').kind).toBe('linkedin')
    expect(kind('Cover letter').kind).toBe('coverLetter')
    expect(kind('Years of experience').kind).toBe('experienceYears')
  })

  it('prefers the field name over text floating nearby', () => {
    const named = classifyField(
      field({ name: 'company', nearbyText: 'City of the office where we hire engineers' }),
    )
    expect(named.kind).toBe('company')
    expect(named.confidence).toBeGreaterThan(0.9)
  })

  it('lets the input type decide without reading a word', () => {
    expect(kind('', { inputType: 'email' })).toMatchObject({ kind: 'email', confidence: 0.99 })
    expect(kind('', { inputType: 'password' }).kind).toBe('password')
    expect(kind('', { inputType: 'tel' }).kind).toBe('phone')
    expect(kind('', { inputType: 'file' }).kind).toBe('file')
    expect(kind('', { inputType: 'date', label: 'Birth date' }).kind).toBe('dob')
  })

  it('blocks the dangerous ones before any value rule runs', () => {
    expect(kind('Card number').kind).toBe('card')
    expect(kind('I agree to the terms').kind).toBe('consent')
    expect(kind('Enter the code we texted you').kind).toBe('unknown')
    expect(kind('One-time code').kind).toBe('otp')
    expect(kind("I'm not a robot").kind).toBe('captcha')
    expect(kind('Social security number').kind).toBe('ssn')
    expect(kind('Upload resume file').kind).toBe('file')

    const consentBox = classifyField(field({ inputType: 'checkbox', label: 'Accept terms' }))
    expect(consentBox.kind).toBe('consent')
  })

  it('never calls a payment field an address field', () => {
    expect(isBlockedKind(kind('Billing address').kind)).toBe(true)
    expect(BLOCKED_REASONS[kind('Billing address').kind]).toContain('hard block')
  })

  it('reports an anonymous field as low-confidence unknown', () => {
    const blank = classifyField(field({}))
    expect(blank).toEqual({ kind: 'unknown', confidence: 0.2 })
  })

  it('downgrades a kind matched only by weak nearby text', () => {
    const weak = classifyField(field({ nearbyText: 'Email' }))
    expect(weak.kind).toBe('email')
    expect(weak.confidence).toBeLessThan(0.85)
  })
})
