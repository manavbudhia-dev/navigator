import { describe, expect, it } from 'vitest'

import { coreTools } from './definitions'
import { ToolRegistry } from './registry'
import { stubChromeHost } from './testUtils'
import { emptyProfile } from '@/types/vault'
import type { ActRequest } from '@/types/actions'
import type { FormFieldView } from '@/content/formFields'
import type { Profile, ProfileMeta } from '@/types/vault'
import type { ChatMessage, CompletionResult } from '@/llm/types'
import type { ToolContext, ToolHost, VaultAccess } from './types'

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

function profile(): Profile {
  const p = emptyProfile('p1', 'Personal')
  p.identity.firstName = 'Manav'
  p.contact.email = 'manav@example.com'
  p.contact.phone = '+91 98200 00000'
  p.contact.altPhone = '+91 90000 00000'
  return p
}

interface Harness {
  ctx: ToolContext
  acts: ActRequest[]
  reviewCalls: number[][]
  completions: ChatMessage[][]
}

function harness(
  fields: FormFieldView[],
  options: {
    vault?: VaultAccess
    reply?: string
    actFailure?: { index: number; error: string }
  } = {},
): Harness {
  const acts: ActRequest[] = []
  const reviewCalls: number[][] = []
  const completions: ChatMessage[][] = []

  const host = {
    async pageState() {
      return {
        url: 'https://example.com/join',
        title: 'Join',
        readyState: 'complete',
        scrollPercent: 0,
        pageHeightPx: 900,
        viewport: { width: 800, height: 600 },
        loginState: 'unknown',
        elementLines: [],
        elementCount: 0,
        inViewportCount: 0,
        markdown: '',
        truncatedElements: false,
        truncatedMarkdown: false,
        tokenEstimate: 0,
        capturedAt: 0,
      }
    },
    async formFields() {
      return fields
    },
    async act(_tabId: number, action: ActRequest) {
      acts.push(action)
      if (options.actFailure && action.type === 'type' && action.index === options.actFailure.index) {
        return { ok: false, error: options.actFailure.error }
      }
      return { ok: true, detail: 'Typed' }
    },
    async navigate() {},
    async openTab() {
      return 1
    },
    async sleep() {},
    review(_tabId: number, indices: number[]) {
      reviewCalls.push(indices)
    },
    async locate() {
      return null
    },
    ...stubChromeHost(),
  } satisfies ToolHost

  const complete = async (messages: ChatMessage[]): Promise<CompletionResult> => {
    completions.push(messages)
    return {
      message: { role: 'assistant', content: options.reply ?? '{}' },
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: 'stop',
    }
  }

  const controller = new AbortController()
  return {
    ctx: {
      host,
      tabId: 1,
      signal: controller.signal,
      complete,
      ...(options.vault ? { vault: options.vault } : {}),
    },
    acts,
    reviewCalls,
    completions,
  }
}

function vaultWith(profiles: Profile[]): VaultAccess {
  const meta: ProfileMeta[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    updatedAt: p.updatedAt,
    filled: 3,
  }))
  return {
    isUnlocked: true,
    async list() {
      return meta
    },
    async get(id) {
      return profiles.find((p) => p.id === id) ?? null
    },
  }
}

function lockedVault(): VaultAccess {
  return {
    isUnlocked: false,
    async list() {
      return []
    },
    async get() {
      return null
    },
  }
}

const registry = new ToolRegistry(coreTools())

describe('fill_form', () => {
  it('types each planned value into its own field and never submits', async () => {
    const h = harness(
      [
        field({ index: 0, label: 'First name' }),
        field({ index: 1, label: 'Email address' }),
        field({ index: 2, label: 'Confirm email' }),
      ],
      { vault: vaultWith([profile()]) },
    )

    const result = await registry.execute('fill_form', {}, h.ctx)
    expect(result.ok).toBe(true)
    expect(h.acts).toEqual([
      { type: 'type', index: 0, text: 'Manav' },
      { type: 'type', index: 1, text: 'manav@example.com' },
      { type: 'type', index: 2, text: 'manav@example.com' },
    ])
    expect(h.acts.some((a) => a.type === 'type' && a.submit === true)).toBe(false)
    expect(result.content).toContain('Filled 3 field(s)')
    expect(result.content).toContain('<- contact.email')
  })

  it('keeps the secret values out of the transcript the model reads back', async () => {
    const h = harness([field({ index: 0, label: 'Email address' })], { vault: vaultWith([profile()]) })
    const result = await registry.execute('fill_form', {}, h.ctx)
    expect(result.content).not.toContain('manav@example.com')
  })

  it('asks the small model only about ambiguous fields, with only their candidates', async () => {
    const h = harness(
      [
        field({ index: 0, label: 'First name' }),
        field({ index: 1, label: 'Phone' }),
      ],
      { vault: vaultWith([profile()]), reply: '{"1": "+91 90000 00000"}' },
    )

    const result = await registry.execute('fill_form', {}, h.ctx)
    expect(h.completions).toHaveLength(1)
    expect(h.completions[0]?.[1]?.content).toContain('Field index 1')
    expect(h.completions[0]?.[1]?.content).not.toContain('First name')
    expect(h.acts).toEqual([
      { type: 'type', index: 0, text: 'Manav' },
      { type: 'type', index: 1, text: '+91 90000 00000' },
    ])
    expect(result.content).toContain('Filled 2 field(s)')
  })

  it('ignores a model answer that invents a value', async () => {
    const h = harness([field({ index: 1, label: 'Phone' })], {
      vault: vaultWith([profile()]),
      reply: '{"1": "07900 123456"}',
    })
    const result = await registry.execute('fill_form', {}, h.ctx)
    expect(h.acts).toEqual([])
    expect(result.content).toContain('Still unmatched: Phone')
  })

  it('marks blocked fields red on the page instead of filling them', async () => {
    const h = harness(
      [
        field({ index: 0, label: 'First name' }),
        field({ index: 3, label: 'Card number' }),
        field({ index: 4, inputType: 'password', label: 'Password' }),
        field({ index: 5, label: 'Upload your CV file' }),
      ],
      { vault: vaultWith([profile()]) },
    )

    const result = await registry.execute('fill_form', {}, h.ctx)
    expect(h.reviewCalls).toEqual([[3, 4, 5]])
    expect(result.content).toContain('highlighted in red')
    expect(result.content).toContain('Do not fill them yourself')
    expect(h.acts).toEqual([{ type: 'type', index: 0, text: 'Manav' }])
  })

  it('reports a locked vault as the reason and touches nothing', async () => {
    const h = harness([field({ index: 0, label: 'Email address' })], { vault: lockedVault() })
    const result = await registry.execute('fill_form', {}, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('Profiles tab')
    expect(h.acts).toEqual([])
  })

  it('asks for a profile id when several profiles exist', async () => {
    const second = profile()
    second.id = 'p2'
    second.name = 'Work'
    const h = harness([field({ index: 0, label: 'Email address' })], {
      vault: vaultWith([profile(), second]),
    })

    const ambiguous = await registry.execute('fill_form', {}, h.ctx)
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.content).toContain('Personal=p1, Work=p2')

    const chosen = await registry.execute('fill_form', { profile_id: 'p2' }, h.ctx)
    expect(chosen.content).toContain('the "Work" profile')
  })

  it('says so when the page has no fields at all', async () => {
    const h = harness([], { vault: vaultWith([profile()]) })
    const result = await registry.execute('fill_form', {}, h.ctx)
    expect(result).toEqual({ ok: false, content: 'No form fields found on this page.' })
  })

  it('reports a field it could not type into without stopping the rest', async () => {
    const h = harness(
      [
        field({ index: 0, label: 'First name' }),
        field({ index: 1, label: 'Email address' }),
      ],
      { vault: vaultWith([profile()]), actFailure: { index: 0, error: 'element went stale' } },
    )

    const result = await registry.execute('fill_form', {}, h.ctx)
    expect(h.acts).toHaveLength(2)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('Failed: First name: element went stale')
  })

  it('is a write tool so the mode policy gets to approve it', () => {
    expect(registry.get('fill_form')?.kind).toBe('write')
  })
})
