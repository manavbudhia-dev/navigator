import { useState } from 'react'
import { ArrowLeft, KeyRound, Loader2, Lock, Plus, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PROFILE_KINDS, countFilled, type Profile, type ProfileKind } from '@/types/vault'

import type { VaultState } from '../useVault'

/**
 * Profiles tab (spec §6): the vault is created/unlocked here, and the only
 * place a decrypted profile is held is this panel's draft state while it is
 * being edited. Saving sends the profile back to the service worker, where it
 * is encrypted before it touches IndexedDB.
 */

const INPUT =
  'h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
const AREA =
  'w-full rounded-lg border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

export function ProfilesPanel({ vault }: { vault: VaultState }) {
  const [draft, setDraft] = useState<Profile | null>(null)

  if (vault.status === 'no-vault') return <CreateVaultForm vault={vault} />
  if (vault.status === 'locked') return <UnlockForm vault={vault} />

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[22px] font-bold tracking-tight">Profiles</h2>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-3" aria-hidden />
          UNLOCKED
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft(null)
            void vault.call({ action: 'lock' })
          }}
          disabled={vault.busy}
          className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          <Lock className="size-3.5" aria-hidden />
          Lock
        </button>
      </div>

      {vault.error ? <p className="text-xs text-red-600 dark:text-red-400">{vault.error}</p> : null}

      {draft ? (
        <ProfileEditor
          profile={draft}
          onChange={setDraft}
          vault={vault}
          onDone={() => setDraft(null)}
        />
      ) : (
        <ProfileList vault={vault} onOpen={setDraft} />
      )}
    </div>
  )
}

function CreateVaultForm({ vault }: { vault: VaultState }) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-[22px] font-bold tracking-tight">Profile vault</h2>
      <p className="text-xs text-muted-foreground">
        Your details are encrypted with AES-GCM using a key derived from this passphrase
        (310,000 PBKDF2 rounds). The passphrase never leaves this device and there is no
        recovery — if you forget it the vault is unreadable.
      </p>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <Field label="Choose a passphrase">
          <input
            type="password"
            value={pass}
            onChange={(event) => setPass(event.target.value)}
            autoComplete="new-password"
            className={INPUT}
          />
        </Field>
        <Field label="Repeat it">
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            className={INPUT}
          />
        </Field>
        <button
          type="button"
          disabled={vault.busy || pass.length < 8 || pass !== confirm}
          onClick={() => void vault.call({ action: 'create', passphrase: pass })}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {vault.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
          Create vault
        </button>
        {pass !== '' && (pass.length < 8 || pass !== confirm) ? (
          <p className="text-xs text-muted-foreground">
            {pass.length < 8 ? 'At least 8 characters.' : 'The two passphrases do not match.'}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-red-600 dark:text-red-400">{vault.error}</p>
    </div>
  )
}

function UnlockForm({ vault }: { vault: VaultState }) {
  const [pass, setPass] = useState('')

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-[22px] font-bold tracking-tight">Vault locked</h2>
      <p className="text-xs text-muted-foreground">
        Enter the passphrase to decrypt your profiles. The key is kept in memory only and is
        dropped as soon as you lock the vault.
      </p>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <Field label="Passphrase">
          <input
            type="password"
            value={pass}
            onChange={(event) => setPass(event.target.value)}
            autoComplete="off"
            className={INPUT}
          />
        </Field>
        <button
          type="button"
          disabled={vault.busy || pass === ''}
          onClick={() => void vault.call({ action: 'unlock', passphrase: pass })}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {vault.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
          Unlock
        </button>
      </div>
      {vault.error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{vault.error}</p>
      ) : null}
    </div>
  )
}

function ProfileList({ vault, onOpen }: { vault: VaultState; onOpen(p: Profile): void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProfileKind>('personal')

  return (
    <div className="flex flex-col gap-3">
      {vault.profiles.map((meta) => (
        <button
          key={meta.id}
          type="button"
          onClick={() => {
            void vault.open(meta.id).then((profile) => {
              if (profile) onOpen(profile)
            })
          }}
          className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <UserRound className="size-4 text-primary" strokeWidth={1.8} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{meta.name}</span>
            <span className="block text-xs text-muted-foreground">
              {meta.filled} fields · {meta.kind}
            </span>
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Delete ${meta.name}`}
            onClick={async (event) => {
              event.stopPropagation()
              await vault.call({ action: 'delete', id: meta.id })
            }}
            onKeyDown={async (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.stopPropagation()
              await vault.call({ action: 'delete', id: meta.id })
            }}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600"
          >
            <Trash2 className="size-4" aria-hidden />
          </span>
        </button>
      ))}

      {vault.profiles.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
          No profiles yet. The agent can fill forms once you create one.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
        <p className="text-sm font-semibold">New profile</p>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Personal / Acme job search"
          className={INPUT}
        />
        <div className="flex gap-1.5">
          {PROFILE_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted',
                kind === option && 'border-primary bg-primary/10 text-primary',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={vault.busy || name.trim() === ''}
          onClick={() => {
            void vault.call({ action: 'new', name: name.trim(), kind }).then((reply) => {
              if (reply.ok && reply.profile) onOpen(reply.profile)
            })
          }}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          <Plus className="size-4" aria-hidden />
          Create profile
        </button>
      </div>
    </div>
  )
}

function ProfileEditor({
  profile,
  onChange,
  vault,
  onDone,
}: {
  profile: Profile
  onChange(next: Profile): void
  vault: VaultState
  onDone(): void
}) {
  const [saved, setSaved] = useState(false)

  const patch = <K extends keyof Profile>(key: K, value: Profile[K]): void => {
    onChange({ ...profile, [key]: value })
    setSaved(false)
  }

  async function save(): Promise<void> {
    const reply = await vault.call({ action: 'save', profile: { ...profile, updatedAt: Date.now() } })
    if (reply.ok) setSaved(true)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDone}
          className="flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors hover:bg-muted"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </button>
        <p className="ml-auto text-xs text-muted-foreground">{countFilled(profile)} fields</p>
        <button
          type="button"
          disabled={vault.busy}
          onClick={() => void save()}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {saved ? <ShieldCheck className="size-3.5" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
          {saved ? 'Encrypted' : 'Save'}
        </button>
      </div>

      <input
        value={profile.name}
        onChange={(event) => patch('name', event.target.value)}
        className={INPUT}
      />

      <Section title="Identity">
        <div className="grid grid-cols-2 gap-2">
          <Field label="First name">
            <input
              value={profile.identity.firstName}
              onChange={(event) =>
                patch('identity', { ...profile.identity, firstName: event.target.value })
              }
              className={INPUT}
            />
          </Field>
          <Field label="Last name">
            <input
              value={profile.identity.lastName}
              onChange={(event) =>
                patch('identity', { ...profile.identity, lastName: event.target.value })
              }
              className={INPUT}
            />
          </Field>
          <Field label="Full name">
            <input
              value={profile.identity.fullName ?? ''}
              onChange={(event) =>
                patch('identity', { ...profile.identity, fullName: event.target.value })
              }
              className={INPUT}
            />
          </Field>
          <Field label="Date of birth">
            <input
              value={profile.identity.dob ?? ''}
              onChange={(event) =>
                patch('identity', { ...profile.identity, dob: event.target.value })
              }
              placeholder="1994-03-11"
              className={INPUT}
            />
          </Field>
          <Field label="Nationality">
            <input
              value={profile.identity.nationality ?? ''}
              onChange={(event) =>
                patch('identity', { ...profile.identity, nationality: event.target.value })
              }
              className={INPUT}
            />
          </Field>
          <Field label="Gender">
            <input
              value={profile.identity.gender ?? ''}
              onChange={(event) =>
                patch('identity', { ...profile.identity, gender: event.target.value })
              }
              className={INPUT}
            />
          </Field>
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Email">
            <input
              value={profile.contact.email}
              onChange={(event) =>
                patch('contact', { ...profile.contact, email: event.target.value })
              }
              className={INPUT}
            />
          </Field>
          <Field label="Phone">
            <input
              value={profile.contact.phone}
              onChange={(event) =>
                patch('contact', { ...profile.contact, phone: event.target.value })
              }
              className={INPUT}
            />
          </Field>
          <Field label="Alternate phone">
            <input
              value={profile.contact.altPhone ?? ''}
              onChange={(event) =>
                patch('contact', { ...profile.contact, altPhone: event.target.value })
              }
              className={INPUT}
            />
          </Field>
        </div>
      </Section>

      <Section title="Links">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['linkedin', 'LinkedIn'],
              ['github', 'GitHub'],
              ['website', 'Website'],
              ['portfolio', 'Portfolio'],
            ] as const
          ).map(([key, labelText]) => (
            <Field key={key} label={labelText}>
              <input
                value={profile.links[key] ?? ''}
                onChange={(event) => patch('links', { ...profile.links, [key]: event.target.value })}
                className={INPUT}
              />
            </Field>
          ))}
        </div>
      </Section>

      <ArraySection
        title="Addresses"
        items={profile.addresses}
        onItems={(items) => patch('addresses', items)}
        newItem={() => ({
          label: 'home',
          line1: '',
          city: '',
          state: '',
          postalCode: '',
          country: '',
        })}
        labelFor={(item, i) => item.label.trim() || `Address ${i + 1}`}
        fields={[
          { key: 'label', label: 'Label' },
          { key: 'line1', label: 'Line 1' },
          { key: 'line2', label: 'Line 2' },
          { key: 'city', label: 'City' },
          { key: 'state', label: 'State' },
          { key: 'postalCode', label: 'Postal code' },
          { key: 'country', label: 'Country' },
        ]}
      />

      <ArraySection
        title="Work experience"
        items={profile.work}
        onItems={(items) => patch('work', items)}
        newItem={() => ({ company: '', title: '' })}
        labelFor={(item, i) => item.title.trim() || `Role ${i + 1}`}
        fields={[
          { key: 'company', label: 'Company' },
          { key: 'title', label: 'Title' },
          { key: 'start', label: 'Start' },
          { key: 'end', label: 'End' },
          { key: 'summary', label: 'Summary' },
        ]}
      />

      <ArraySection
        title="Education"
        items={profile.education}
        onItems={(items) => patch('education', items)}
        newItem={() => ({ school: '', degree: '' })}
        labelFor={(item, i) => item.school.trim() || `School ${i + 1}`}
        fields={[
          { key: 'school', label: 'School' },
          { key: 'degree', label: 'Degree' },
          { key: 'field', label: 'Field' },
          { key: 'start', label: 'Start' },
          { key: 'end', label: 'End' },
        ]}
      />

      <Section title="Documents">
        {profile.documents.map((doc, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-2">
            <div className="flex items-center gap-2">
              <input
                value={doc.fileName}
                onChange={(event) => {
                  const next = [...profile.documents]
                  next[i] = { ...doc, fileName: event.target.value }
                  patch('documents', next)
                }}
                placeholder="resume.pdf"
                className={INPUT}
              />
              <button
                type="button"
                aria-label="Remove document"
                onClick={() =>
                  patch(
                    'documents',
                    profile.documents.filter((_, index) => index !== i),
                  )
                }
                className="rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            <select
              value={doc.kind}
              onChange={(event) => {
                const next = [...profile.documents]
                next[i] = {
                  ...doc,
                  kind: event.target.value as 'resume' | 'cover-letter' | 'other',
                }
                patch('documents', next)
              }}
              className={INPUT}
            >
              <option value="resume">resume</option>
              <option value="cover-letter">cover letter</option>
              <option value="other">other</option>
            </select>
            <textarea
              value={doc.text ?? ''}
              onChange={(event) => {
                const next = [...profile.documents]
                next[i] = { ...doc, text: event.target.value }
                patch('documents', next)
              }}
              rows={3}
              placeholder="Text of the document (used when a form asks for a cover letter body)"
              className={AREA}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            patch('documents', [...profile.documents, { fileName: '', kind: 'resume' }])
          }
          className="flex h-8 items-center gap-1 self-start rounded-lg border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" aria-hidden />
          Add document reference
        </button>
      </Section>

      <Section title="Skills">
        <textarea
          value={profile.skills.join('\n')}
          onChange={(event) =>
            patch(
              'skills',
              event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line !== '')
                .slice(0, 100),
            )
          }
          rows={4}
          placeholder="One skill per line"
          className={AREA}
        />
      </Section>

      <Section title="Canned answers">
        {Object.entries(profile.answers).map(([key, value]) => (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                value={key}
                onChange={(event) => {
                  const next: Record<string, string> = {}
                  for (const [k, v] of Object.entries(profile.answers)) {
                    next[k === key ? event.target.value : k] = k === key ? v : v
                  }
                  patch('answers', next)
                }}
                className={INPUT}
              />
              <button
                type="button"
                aria-label={`Remove ${key}`}
                onClick={() => {
                  const next = { ...profile.answers }
                  delete next[key]
                  patch('answers', next)
                }}
                className="rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            <textarea
              value={value}
              onChange={(event) =>
                patch('answers', { ...profile.answers, [key]: event.target.value })
              }
              rows={2}
              className={AREA}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            patch('answers', { ...profile.answers, [`question_${Date.now() % 1000}`]: '' })
          }
          className="flex h-8 items-center gap-1 self-start rounded-lg border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" aria-hidden />
          Add answer
        </button>
      </Section>

      {vault.error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{vault.error}</p>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <p className="text-sm font-semibold">{title}</p>
      {children}
    </section>
  )
}

interface ItemField<T extends object> {
  key: keyof T
  label: string
}

function ArraySection<T extends object>({
  title,
  items,
  onItems,
  newItem,
  labelFor,
  fields,
}: {
  title: string
  items: T[]
  onItems(items: T[]): void
  newItem(): NoInfer<T>
  labelFor(item: T, index: number): string
  fields: ItemField<T>[]
}) {
  return (
    <Section title={title}>
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-2">
          <div className="flex items-center gap-2">
            <p className="flex-1 truncate text-xs font-medium text-muted-foreground">
              {labelFor(item, i)}
            </p>
            <button
              type="button"
              aria-label={`Remove ${labelFor(item, i)}`}
              onClick={() => onItems(items.filter((_, index) => index !== i))}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {fields.map((field) => (
              <Field key={String(field.key)} label={field.label}>
                <input
                  value={String(item[field.key] ?? '')}
                  onChange={(event) => {
                    const next = [...items]
                    next[i] = { ...item, [field.key]: event.target.value }
                    onItems(next)
                  }}
                  className={INPUT}
                />
              </Field>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onItems([...items, newItem()])}
        className="flex h-8 items-center gap-1 self-start rounded-lg border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        <Plus className="size-3.5" aria-hidden />
        Add
      </button>
    </Section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
