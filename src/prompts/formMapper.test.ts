import { describe, expect, it } from 'vitest'

import { allowedValuesFor, buildFormMappingMessages, parseFormMapping } from './formMapper'
import type { AmbiguousField } from '@/forms/mapper'

const fields: AmbiguousField[] = [
  {
    index: 4,
    label: 'Phone',
    kind: 'phone',
    candidates: [
      { key: 'contact.phone', value: '+91 98200 00000' },
      { key: 'contact.altPhone', value: '+91 90000 00000' },
    ],
  },
  { index: 9, label: 'City', kind: 'city', candidates: [{ key: 'addresses[0].city', value: 'Mumbai' }] },
]

describe('form mapping prompt', () => {
  it('shows only the candidate values for the fields being asked about', () => {
    const messages = buildFormMappingMessages(fields, '')
    const user = messages[1]?.content ?? ''
    expect(user).toContain('Field index 4')
    expect(user).toContain('+91 90000 00000')
    expect(user).not.toContain('manav@example.com')
    expect(messages[0]?.content).toContain('Never invent a value')
  })

  it('parses fenced JSON and drops anything the model invented', () => {
    const allowed = allowedValuesFor(fields)
    const parsed = parseFormMapping(
      'Here you go:\n```json\n{"4": "+91 90000 00000", "9": "Delhi", "77": "Mumbai"}\n```',
      allowed,
    )
    expect(parsed).toEqual({ '4': '+91 90000 00000' })
  })

  it('survives a reply that is not JSON at all', () => {
    expect(parseFormMapping('I could not decide.', allowedValuesFor(fields))).toEqual({})
  })
})
