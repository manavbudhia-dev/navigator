import { z } from 'zod'

/**
 * Profile vault types (spec §6). The decrypted profile only ever exists in the
 * service worker's memory; IndexedDB holds AES-GCM envelopes and the LLM sees
 * at most the handful of values an ambiguous field needs to choose between.
 */

export const PROFILE_KINDS = ['personal', 'work', 'job-search', 'test'] as const
export type ProfileKind = (typeof PROFILE_KINDS)[number]

const Text = z.string().max(4000).default('')
const Optional = z.string().max(4000).optional()

export const AddressSchema = z.object({
  label: Text,
  line1: Text,
  line2: Optional,
  city: Text,
  state: Text,
  postalCode: Text,
  country: Text,
})

export const JobSchema = z.object({
  company: Text,
  title: Text,
  start: Optional,
  end: Optional,
  summary: Optional,
})

export const EducationSchema = z.object({
  school: Text,
  degree: Text,
  field: Optional,
  start: Optional,
  end: Optional,
})

export const DocumentSchema = z.object({
  fileName: Text,
  kind: z.enum(['resume', 'cover-letter', 'other']).default('other'),
  text: Optional,
})

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  kind: z.enum(PROFILE_KINDS).default('personal'),
  updatedAt: z.number().int().default(0),
  identity: z
    .object({
      firstName: Text,
      lastName: Text,
      fullName: Optional,
      dob: Optional,
      nationality: Optional,
      gender: Optional,
    })
    .default({ firstName: '', lastName: '' }),
  contact: z
    .object({
      email: Text,
      phone: Text,
      altPhone: Optional,
    })
    .default({ email: '', phone: '' }),
  links: z
    .object({
      linkedin: Optional,
      github: Optional,
      website: Optional,
      portfolio: Optional,
    })
    .default({}),
  addresses: z.array(AddressSchema).default([]),
  work: z.array(JobSchema).default([]),
  education: z.array(EducationSchema).default([]),
  skills: z.array(z.string().max(120)).default([]),
  documents: z.array(DocumentSchema).default([]),
  /** Canned answers keyed by the question they fit ("why_this_role"). */
  answers: z.record(z.string(), z.string().max(4000)).default({}),
})

export type Profile = z.infer<typeof ProfileSchema>
export type Address = z.infer<typeof AddressSchema>

export interface ProfileMeta {
  id: string
  name: string
  kind: ProfileKind
  updatedAt: number
  /** How many fields are filled in — shown in the list without decrypting more. */
  filled: number
}

export type VaultStatus = 'no-vault' | 'locked' | 'unlocked'

export type VaultRequest =
  | { action: 'status' }
  | { action: 'unlock'; passphrase: string }
  | { action: 'create'; passphrase: string }
  | { action: 'lock' }
  | { action: 'list' }
  | { action: 'get'; id: string }
  | { action: 'save'; profile: Profile }
  | { action: 'delete'; id: string }
  | { action: 'new'; name: string; kind: ProfileKind }

export interface VaultReply {
  ok: boolean
  error?: string
  status?: VaultStatus
  profiles?: ProfileMeta[]
  profile?: Profile | null
}

export function emptyProfile(id: string, name: string, kind: ProfileKind = 'personal'): Profile {
  return ProfileSchema.parse({ id, name, kind, updatedAt: Date.now() })
}

/** Rough count of populated fields, used for the "32 fields" badge. */
export function countFilled(profile: Profile): number {
  let n = 0
  const bump = (value: unknown): void => {
    if (typeof value === 'string' && value.trim() !== '') n += 1
    else if (Array.isArray(value) && value.length > 0) n += 1
    else if (value && typeof value === 'object') for (const inner of Object.values(value)) bump(inner)
  }
  for (const section of Object.values(profile)) {
    if (section && typeof section === 'object') {
      for (const value of Object.values(section)) bump(value)
    }
  }
  return n
}
