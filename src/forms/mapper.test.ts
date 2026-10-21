import { describe, expect, it } from 'vitest'

import {
  applyMapping,
  candidatesForKind,
  levenshtein,
  matchOption,
  normalizeDate,
  planFill,
} from './mapper'
import type { FormFieldView } from '@/content/formFields'
import { emptyProfile, type Profile } from '@/types/vault'

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

function filledProfile(): Profile {
  const profile = emptyProfile('p1', 'Personal')
  profile.identity.firstName = 'Manav'
  profile.identity.lastName = 'Shah'
  profile.identity.dob = '1994-03-11'
  profile.contact.email = 'manav@example.com'
  profile.contact.phone = '+91 98200 00000'
  profile.contact.altPhone = '+91 90000 00000'
  profile.addresses = [
    {
      label: 'home',
      line1: '12 Marine Drive',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400020',
      country: 'India',
    },
  ]
  profile.skills = ['TypeScript', 'React']
  return profile
}

describe('candidatesForKind', () => {
  it('offers the two phone numbers so the mapper can choose', () => {
    expect(candidatesForKind(filledProfile(), 'phone').map((c) => c.key)).toEqual([
      'contact.phone',
      'contact.altPhone',
    ])
  })

  it('builds a full name from the parts when only the parts exist', () => {
    const profile = emptyProfile('p', 'x')
    profile.identity.firstName = 'Ada'
    profile.identity.lastName = 'Lovelace'
    expect(candidatesForKind(profile, 'fullName').map((c) => c.value)).toContain('Ada Lovelace')
  })

  it('offers a cover letter only as document text, never as a file path', () => {
    const profile = emptyProfile('p', 'x')
    profile.documents = [
      { fileName: 'resume.pdf', kind: 'resume' },
      { fileName: 'cover.txt', kind: 'cover-letter', text: 'Dear hiring manager…' },
    ]
    expect(candidatesForKind(profile, 'coverLetter')).toEqual([
      { key: 'documents.cover.txt', value: 'Dear hiring manager…' },
    ])
  })

  it('returns nothing for kinds the profile cannot answer', () => {
    expect(candidatesForKind(emptyProfile('p', 'x'), 'captcha')).toEqual([])
  })
})

describe('dropdown matching', () => {
  it('takes the exact option text back from a fuzzy match', () => {
    expect(matchOption(['United States', 'India', 'Germany'], 'USA')).toBe('United States')
    expect(matchOption(['MA — Maharashtra', 'DL'], 'Maharashtra')).toBe('MA — Maharashtra')
  })

  it('returns null rather than guessing an unrelated option', () => {
    expect(matchOption(['Red', 'Green'], 'Thursday')).toBeNull()
    expect(matchOption([], 'India')).toBeNull()
  })

  it('is symmetric', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('same', 'same')).toBe(0)
  })
})

describe('normalizeDate', () => {
  it('keeps ISO for a date input', () => {
    expect(normalizeDate('1994-03-11', { inputType: 'date', placeholder: '', pattern: '' })).toBe(
      '1994-03-11',
    )
  })

  it('follows the placeholder format', () => {
    expect(normalizeDate('1994-03-11', { inputType: 'text', placeholder: 'MM/DD/YYYY', pattern: '' })).toBe(
      '3/11/1994',
    )
    expect(normalizeDate('1994-03-11', { inputType: 'text', placeholder: 'DD/MM/YYYY', pattern: '' })).toBe(
      '11/3/1994',
    )
  })

  it('leaves a value it cannot parse untouched', () => {
    expect(normalizeDate('March 94', { inputType: 'text', placeholder: 'MM/DD/YYYY', pattern: '' })).toBe(
      'March 94',
    )
  })
})

describe('planFill', () => {
  it('fills what it is sure about, blocks what it must not touch', () => {
    const plan = planFill(
      [
        field({ index: 0, label: 'First name' }),
        field({ index: 1, label: 'Email address' }),
        field({ index: 2, label: 'Date of birth' }),
        field({ index: 3, label: 'Card number' }),
        field({ index: 4, inputType: 'password', label: 'Create a password' }),
      ],
      filledProfile(),
    )

    expect(plan.fills.map((f) => [f.index, f.value, f.profileKey])).toEqual([
      [0, 'Manav', 'identity.firstName'],
      [1, 'manav@example.com', 'contact.email'],
      [2, '1994-03-11', 'identity.dob'],
    ])
    expect(plan.blocked.map((b) => b.kind)).toEqual(['card', 'password'])
    expect(plan.ambiguous).toEqual([])
  })

  it('sends a field with two plausible values to the LLM instead of picking one', () => {
    const plan = planFill([field({ index: 0, label: 'Phone' })], filledProfile())
    expect(plan.fills).toEqual([])
    expect(plan.ambiguous[0]?.candidates).toHaveLength(2)
  })

  it('leaves already-filled and unusable controls alone', () => {
    const plan = planFill(
      [
        field({ index: 0, label: 'First name', value: 'Manav' }),
        field({ index: 1, inputType: 'checkbox', label: 'Subscribe to updates' }),
        field({ index: 2, inputType: 'radio', label: 'City' }),
        field({ index: -1, label: 'First name' }),
      ],
      filledProfile(),
    )
    expect(plan.fills).toEqual([])
    expect(plan.blocked.map((b) => [b.index, b.kind])).toEqual([[1, 'consent']])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['already-filled', 'not-text', 'not-text'])
  })

  it('maps a country input onto the dropdown option the page offers', () => {
    const plan = planFill(
      [field({ index: 0, label: 'Country', options: ['India', 'United States'], inputType: 'select-one' })],
      filledProfile(),
    )
    expect(plan.fills[0]?.value).toBe('India')
  })

  it('skips a dropdown whose options contain nothing close', () => {
    const plan = planFill(
      [field({ index: 0, label: 'Country', options: ['Zimbabwe', 'Norway'], inputType: 'select-one' })],
      filledProfile(),
    )
    expect(plan.skipped.map((s) => s.reason)).toContain('no-match')
  })

  it('trims a value to the field maxLength instead of letting the browser cut it', () => {
    const plan = planFill(
      [field({ index: 0, label: 'Skills', maxLength: 10 })],
      filledProfile(),
    )
    expect(plan.fills[0]?.value).toBe('TypeScript')
  })

  it('never fills a field the profile has no answer for', () => {
    const plan = planFill([field({ index: 0, label: 'University' })], filledProfile())
    expect(plan.skipped.map((s) => s.reason)).toEqual(['no-value'])
  })
})

describe('applyMapping', () => {
  it('accepts only a value that was actually offered for that field', () => {
    const plan = planFill([field({ index: 5, label: 'Phone' })], filledProfile())
    const invented = applyMapping(plan, { '5': '0700000000' })
    expect(invented.fills).toEqual([])
    expect(invented.ambiguous).toHaveLength(1)

    const chosen = applyMapping(plan, { '5': '+91 90000 00000' })
    expect(chosen.fills).toEqual([
      expect.objectContaining({ index: 5, value: '+91 90000 00000', profileKey: 'contact.altPhone', source: 'llm' }),
    ])
    expect(chosen.ambiguous).toEqual([])
  })
})
