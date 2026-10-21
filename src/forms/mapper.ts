import { BLOCKED_REASONS, classifyField, isBlockedKind, type FieldKind } from './fields'
import type { FormFieldView } from '@/content/formFields'
import type { Profile } from '@/types/vault'

/**
 * Turning classified fields into a fill plan (spec §6). Confidence above
 * `DETERMINISTIC_AT` fills straight from the vault; anything shakier is handed
 * to the LLM as a multiple-choice question with only the candidate values for
 * that one field, never the whole profile.
 */

export const DETERMINISTIC_AT = 0.85
export const ASK_LLM_AT = 0.5

export interface PlannedFill {
  index: number
  label: string
  kind: FieldKind
  value: string
  /** Which vault path the value came from, e.g. "contact.email". */
  profileKey: string
  confidence: number
  source: 'deterministic' | 'llm'
}

export interface AmbiguousField {
  index: number
  label: string
  kind: FieldKind
  candidates: Array<{ key: string; value: string }>
}

export interface BlockedField {
  index: number
  label: string
  kind: FieldKind
  reason: string
}

export interface SkippedField {
  index: number
  label: string
  reason: 'no-value' | 'no-match' | 'already-filled' | 'not-text'
}

export interface FillPlan {
  fills: PlannedFill[]
  ambiguous: AmbiguousField[]
  blocked: BlockedField[]
  skipped: SkippedField[]
}

export interface Candidate {
  key: string
  value: string
}

function text(value: string | undefined | null): string {
  return (value ?? '').trim()
}

/** Every value the profile offers for a semantic kind, best guess first. */
export function candidatesForKind(profile: Profile, kind: FieldKind): Candidate[] {
  const address = profile.addresses[0]
  const job = profile.work[0]
  const school = profile.education[0]
  const answer = profile.answers

  switch (kind) {
    case 'firstName':
      return [{ key: 'identity.firstName', value: text(profile.identity.firstName) }]
    case 'lastName':
      return [{ key: 'identity.lastName', value: text(profile.identity.lastName) }]
    case 'fullName':
      return [
        { key: 'identity.fullName', value: text(profile.identity.fullName) },
        {
          key: 'identity.firstName + lastName',
          value: [text(profile.identity.firstName), text(profile.identity.lastName)].filter(Boolean).join(' '),
        },
      ]
    case 'email':
      return [{ key: 'contact.email', value: text(profile.contact.email) }]
    case 'phone':
      return [
        { key: 'contact.phone', value: text(profile.contact.phone) },
        { key: 'contact.altPhone', value: text(profile.contact.altPhone) },
      ]
    case 'dob':
      return [{ key: 'identity.dob', value: text(profile.identity.dob) }]
    case 'address1':
      return [{ key: 'addresses[0].line1', value: text(address?.line1) }]
    case 'address2':
      return [{ key: 'addresses[0].line2', value: text(address?.line2) }]
    case 'city':
      return [{ key: 'addresses[0].city', value: text(address?.city) }]
    case 'state':
      return [{ key: 'addresses[0].state', value: text(address?.state) }]
    case 'postalCode':
      return [{ key: 'addresses[0].postalCode', value: text(address?.postalCode) }]
    case 'country':
      return [{ key: 'addresses[0].country', value: text(address?.country) }]
    case 'company':
      return [{ key: 'work[0].company', value: text(job?.company) }]
    case 'jobTitle':
      return [{ key: 'work[0].title', value: text(job?.title) }]
    case 'experienceYears':
      return [{ key: 'answers.experienceYears', value: text(answer['experienceYears']) }]
    case 'skills':
      return profile.skills.length > 0 ? [{ key: 'skills', value: profile.skills.join(', ') }] : []
    case 'school':
      return [{ key: 'education[0].school', value: text(school?.school) }]
    case 'degree':
      return [
        { key: 'education[0].degree', value: text(school?.degree) },
        { key: 'education[0].field', value: text(school?.field) },
      ]
    case 'linkedin':
      return [{ key: 'links.linkedin', value: text(profile.links.linkedin) }]
    case 'github':
      return [{ key: 'links.github', value: text(profile.links.github) }]
    case 'website':
      return [
        { key: 'links.website', value: text(profile.links.website) },
        { key: 'links.portfolio', value: text(profile.links.portfolio) },
      ]
    case 'coverLetter':
      return profile.documents
        .filter((doc) => doc.kind === 'cover-letter' && text(doc.text) !== '')
        .map((doc) => ({ key: `documents.${doc.fileName}`, value: text(doc.text) }))
    case 'freeText':
      return Object.entries(answer)
        .filter(([, value]) => text(value) !== '')
        .map(([key, value]) => ({ key: `answers.${key}`, value: text(value) }))
    default:
      return []
  }
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost)
    }
    previous = current
  }
  return previous[b.length]!
}

const SYNONYMS: Record<string, string> = {
  usa: 'united states',
  us: 'united states',
  'united states of america': 'united states',
  america: 'united states',
  india: 'india',
  in: 'india',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  germany: 'germany',
  de: 'germany',
}

function canonical(value: string): string {
  const lower = value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  return SYNONYMS[lower] ?? lower
}

/** Fuzzy-match a profile value against a dropdown's option text (spec §6.4). */
export function matchOption(options: string[], value: string): string | null {
  const target = canonical(value)
  if (target === '') return null

  const exact = options.find((option) => canonical(option) === target)
  if (exact) return exact

  let best: { option: string; score: number } | null = null
  for (const option of options) {
    const candidate = canonical(option)
    if (candidate === '') continue
    const contains = candidate.includes(target) || target.includes(candidate)
    const distance = levenshtein(candidate, target)
    const longest = Math.max(candidate.length, target.length, 1)
    const score = (1 - distance / longest) + (contains ? 0.25 : 0)
    if (score >= 0.75 && (!best || score > best.score)) best = { option, score }
  }
  return best?.option ?? null
}

const DATE_FORMATS = [
  { re: /y{4}[-/]m{2}[-/]d{2}/i, name: 'iso' },
  { re: /m{1,2}[-/]d{1,2}[-/]y{4}/i, name: 'mdy' },
  { re: /d{1,2}[-/]m{1,2}[-/]y{4}/i, name: 'dmy' },
] as const

function parts(iso: string): { y: string; m: string; d: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!match) return null
  return { y: match[1]!, m: match[2]!, d: match[3]! }
}

/** Rewrite an ISO date into whatever shape the page asks for (spec §6.5). */
export function normalizeDate(iso: string, field: Pick<FormFieldView, 'placeholder' | 'pattern' | 'inputType'>): string {
  const parsed = parts(iso)
  if (!parsed) return iso
  if (field.inputType === 'date') return `${parsed.y}-${parsed.m}-${parsed.d}`

  const clue = `${field.placeholder} ${field.pattern}`
  const format = DATE_FORMATS.find((candidate) => candidate.re.test(clue))
  if (!format) return `${parsed.y}-${parsed.m}-${parsed.d}`
  if (format.name === 'iso') return `${parsed.y}-${parsed.m}-${parsed.d}`
  if (format.name === 'mdy') return `${Number(parsed.m)}/${Number(parsed.d)}/${parsed.y}`
  return `${Number(parsed.d)}/${Number(parsed.m)}/${parsed.y}`
}

function fitLength(value: string, field: FormFieldView): string {
  if (field.maxLength === null || value.length <= field.maxLength) return value
  return value.slice(0, field.maxLength)
}

function fieldLabel(field: FormFieldView): string {
  return field.label || field.placeholder || field.name || field.id || `${field.tag} ${field.index}`
}

const TEXT_TYPES = new Set(['text', 'email', 'tel', 'search', 'url', 'number', 'date', 'textarea', 'select-one'])

export function planFill(fields: FormFieldView[], profile: Profile): FillPlan {
  const plan: FillPlan = { fills: [], ambiguous: [], blocked: [], skipped: [] }

  for (const field of fields) {
    const label = fieldLabel(field)

    if (field.index < 0) {
      plan.skipped.push({ index: field.index, label, reason: 'not-text' })
      continue
    }

    const { kind, confidence } = classifyField(field)

    // Classified before the type check: a "I agree" checkbox is a consent field
    // that needs the user, not a control to be silently passed over.
    if (isBlockedKind(kind)) {
      plan.blocked.push({ index: field.index, label, kind, reason: BLOCKED_REASONS[kind] ?? 'Needs review' })
      continue
    }
    if (!TEXT_TYPES.has(field.inputType)) {
      plan.skipped.push({ index: field.index, label, reason: 'not-text' })
      continue
    }
    if (text(field.value) !== '') {
      plan.skipped.push({ index: field.index, label, reason: 'already-filled' })
      continue
    }

    const candidates = candidatesForKind(profile, kind).filter((candidate) => candidate.value !== '')
    if (candidates.length === 0) {
      plan.skipped.push({ index: field.index, label, reason: 'no-value' })
      continue
    }

    const [first, ...rest] = candidates as [Candidate, ...Candidate[]]
    const unique = rest.length === 0

    if (kind === 'dob' || field.inputType === 'date') {
      plan.fills.push({
        index: field.index,
        label,
        kind,
        value: normalizeDate(first.value, field),
        profileKey: first.key,
        confidence,
        source: 'deterministic',
      })
      continue
    }

    if (field.options.length > 0) {
      const matched = matchOption(field.options, first.value)
      if (!matched && !unique) {
        plan.ambiguous.push({ index: field.index, label, kind, candidates })
        continue
      }
      if (!matched) {
        plan.skipped.push({ index: field.index, label, reason: 'no-match' })
        continue
      }
      plan.fills.push({
        index: field.index,
        label,
        kind,
        value: matched,
        profileKey: first.key,
        confidence,
        source: 'deterministic',
      })
      continue
    }

    const fill = (value: string, source: PlannedFill['source']): void => {
      plan.fills.push({
        index: field.index,
        label,
        kind,
        value: fitLength(value, field),
        profileKey: source === 'deterministic' ? first.key : 'llm',
        confidence,
        source,
      })
    }

    if (confidence >= DETERMINISTIC_AT && unique) fill(first.value, 'deterministic')
    else if (confidence >= ASK_LLM_AT) plan.ambiguous.push({ index: field.index, label, kind, candidates })
    else plan.skipped.push({ index: field.index, label, reason: 'no-value' })
  }

  return plan
}

/** Apply the LLM's multiple-choice answers back onto the plan. */
export function applyMapping(plan: FillPlan, mapping: Record<string, string>): FillPlan {
  const byIndex = new Map(plan.ambiguous.map((field) => [String(field.index), field]))
  const fills = [...plan.fills]
  const resolved: string[] = []

  for (const [key, value] of Object.entries(mapping)) {
    const field = byIndex.get(key)
    if (!field) continue
    const candidate = field.candidates.find((entry) => entry.value === value)
    if (!candidate) continue
    fills.push({
      index: field.index,
      label: field.label,
      kind: field.kind,
      value: candidate.value,
      profileKey: candidate.key,
      confidence: 0.8,
      source: 'llm',
    })
    resolved.push(key)
  }

  return {
    fills,
    ambiguous: plan.ambiguous.filter((field) => !resolved.includes(String(field.index))),
    blocked: plan.blocked,
    skipped: plan.skipped,
  }
}
