import type { FormFieldView } from '@/content/formFields'

/**
 * Semantic field classification (spec §6). Deterministic first: label, name,
 * id, placeholder and nearby text carry almost all the signal on real forms.
 * Anything the model has to guess at is reported as low confidence so the
 * caller can either ask the LLM or leave the field alone.
 */

export type FieldKind =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'dob'
  | 'address1'
  | 'address2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country'
  | 'company'
  | 'jobTitle'
  | 'experienceYears'
  | 'skills'
  | 'school'
  | 'degree'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'coverLetter'
  | 'freeText'
  | 'unknown'
  /** Never auto-filled: these are surfaced for human review instead. */
  | 'captcha'
  | 'otp'
  | 'password'
  | 'card'
  | 'consent'
  | 'file'
  | 'ssn'

export const BLOCKED_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'captcha',
  'otp',
  'password',
  'card',
  'consent',
  'file',
  'ssn',
])

export const BLOCKED_REASONS: Record<string, string> = {
  captcha: 'Captchas are never solved automatically.',
  otp: 'One-time codes come from you, not the vault.',
  password: 'Password creation is a hard block.',
  card: 'Payment details are a hard block.',
  consent: 'Legal consent must be ticked by a human.',
  file: 'File uploads need your approval.',
  ssn: 'Government identifiers are never filled automatically.',
}

interface Rule {
  kind: FieldKind
  re: RegExp
  /** How sure the wording alone makes us. Multi-word, unambiguous labels score 1. */
  strength: number
}

/** Checked first — a "card number" field must never win the "number" pattern. */
const BLOCKED_RULES: Rule[] = [
  { kind: 'captcha', re: /cap-?tcha|re-?captcha|hcaptcha|i(?:'|’)m not a robot|prove you(?:'re| are) (?:a )?(?:human|not a bot)/i, strength: 1 },
  { kind: 'otp', re: /\botp\b|one[-\s]?time|verification code|verify(?:ing)? code|security code|\b2fa\b|authenticator/i, strength: 1 },
  { kind: 'card', re: /card\s*(?:number|no\.?|type|holder)|\bccnum\b|\bcvv\b|\bcvc\b|credit card|debit card|expiry date|exp\s*date|billing address/i, strength: 1 },
  { kind: 'ssn', re: /\bssn\b|social security|\btax identification\b|\bgstin\b|\bnin\b/i, strength: 1 },
  { kind: 'password', re: /password|passphrase|secret question/i, strength: 1 },
  { kind: 'consent', re: /\bi agree|\bi accept|terms of (?:use|service)|consent|sign me up|subscribe to|acknowledge/i, strength: 0.95 },
  { kind: 'file', re: /upload|attach(?:ment)?|resume file|\bcv\b.*file|drop(?:ped)? file|choose file/i, strength: 0.9 },
]

const VALUE_RULES: Rule[] = [
  { kind: 'linkedin', re: /linked\s*in/i, strength: 1 },
  { kind: 'github', re: /git\s*hub/i, strength: 1 },
  { kind: 'coverLetter', re: /cover\s*letter|motivation letter|statement of purpose/i, strength: 1 },
  { kind: 'firstName', re: /first\s*name|given name|forename|\bfname\b/i, strength: 1 },
  { kind: 'lastName', re: /last\s*name|family name|surname|\blname\b/i, strength: 1 },
  { kind: 'fullName', re: /full name|your name|\bapplicant name\b|contact name/i, strength: 0.95 },
  { kind: 'email', re: /e-?mail|email address/i, strength: 1 },
  { kind: 'phone', re: /phone|mobile|cell\s*(?:no|number)?|\btel\b|contact number|\bwhatsapp\b/i, strength: 0.95 },
  { kind: 'dob', re: /date of birth|\bdob\b|birth date|born on|birthday/i, strength: 1 },
  { kind: 'postalCode', re: /zip|postal|postcode|\bpin\s*code\b/i, strength: 1 },
  { kind: 'address2', re: /address\s*(?:line\s*)?2|apartment|\bsuite\b|\bunit\b|\bfloor\b/i, strength: 1 },
  { kind: 'address1', re: /address\s*(?:line\s*)?1|street address|mailing address|\baddress\b/i, strength: 0.95 },
  { kind: 'city', re: /\bcity\b|town|locality/i, strength: 0.95 },
  { kind: 'state', re: /\bstate\b|province|prefecture|\bregion\b/i, strength: 0.9 },
  { kind: 'country', re: /\bcountry\b|\bnation\b/i, strength: 0.95 },
  { kind: 'experienceYears', re: /years(?: of)? experience|total experience|experience\s*\(?years/i, strength: 1 },
  { kind: 'jobTitle', re: /job\s*title|current\s*(?:role|position)|\bdesignation\b|\btitle\b|position applied/i, strength: 0.85 },
  { kind: 'company', re: /company|employer|organisation|organization|current\s*employer/i, strength: 0.95 },
  { kind: 'school', re: /\bschool\b|university|college|institution/i, strength: 0.95 },
  { kind: 'degree', re: /\bdegree\b|qualification|field of study|major/i, strength: 0.95 },
  { kind: 'skills', re: /\bskills?\b|technologies|expertise|tech stack/i, strength: 0.9 },
  { kind: 'website', re: /website|portfolio|personal site|\burl\b|homepage|\bblog\b/i, strength: 0.9 },
  { kind: 'freeText', re: /\bmessage\b|comments?|\bnotes?\b|about you|why\b|additional information|remarks|self[-\s]?intro/i, strength: 0.8 },
]

/** Weight of each hint source: the field's own name beats text floating nearby. */
function hints(field: FormFieldView): Array<{ text: string; weight: number }> {
  return [
    { text: field.name, weight: 1 },
    { text: field.label, weight: 0.98 },
    { text: field.id, weight: 0.95 },
    { text: field.ariaLabel, weight: 0.92 },
    { text: field.placeholder, weight: 0.88 },
    { text: field.nearbyText, weight: 0.62 },
  ].filter((hint) => hint.text !== '')
}

function bestMatch(rules: Rule[], field: FormFieldView): { kind: FieldKind; confidence: number } | null {
  let best: { kind: FieldKind; confidence: number } | null = null
  for (const rule of rules) {
    for (const hint of hints(field)) {
      if (!rule.re.test(hint.text)) continue
      const confidence = Math.min(0.99, rule.strength * hint.weight)
      if (!best || confidence > best.confidence) best = { kind: rule.kind, confidence }
      break
    }
  }
  return best
}

export interface FieldClassification {
  kind: FieldKind
  confidence: number
}

export function classifyField(field: FormFieldView): FieldClassification {
  const structural = structuralKind(field)
  if (structural) return structural

  const blocked = bestMatch(BLOCKED_RULES, field)
  if (blocked) return blocked

  const value = bestMatch(VALUE_RULES, field)
  if (value) return value

  return { kind: 'unknown', confidence: 0.2 }
}

/** Things the input type alone settles, without reading a single word. */
function structuralKind(field: FormFieldView): FieldClassification | null {
  const type = field.inputType
  if (type === 'password') return { kind: 'password', confidence: 0.99 }
  if (type === 'file') return { kind: 'file', confidence: 0.99 }
  if (type === 'email') return { kind: 'email', confidence: 0.99 }
  if (type === 'tel') return { kind: 'phone', confidence: 0.97 }
  if (type === 'date' && /birth|dob|born/i.test(`${field.name} ${field.label} ${field.id} ${field.placeholder}`)) {
    return { kind: 'dob', confidence: 0.97 }
  }
  if (type === 'checkbox' && /agree|accept|consent|terms|subscribe|sign me up/i.test(`${field.name} ${field.label} ${field.id} ${field.nearbyText}`)) {
    return { kind: 'consent', confidence: 0.96 }
  }
  return null
}

export function isBlockedKind(kind: FieldKind): boolean {
  return BLOCKED_KINDS.has(kind)
}
