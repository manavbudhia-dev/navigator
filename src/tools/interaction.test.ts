import { describe, expect, it } from 'vitest'

import { coreTools, pickStoredDocument } from './definitions'
import { ToolRegistry } from './registry'
import { stubNavigation } from './testUtils'
import { emptyProfile } from '@/types/vault'
import type { ActRequest } from '@/types/actions'
import type { PageState } from '@/types/pageState'
import type { Profile, ProfileMeta } from '@/types/vault'
import type { ToolContext, ToolHost, VaultAccess } from './types'

/**
 * The Batch 11 tools (spec §4) at the registry boundary: the arguments the model
 * writes on one side, the request the browser receives on the other.
 */

function pageState(): PageState {
  return {
    url: 'https://example.com/form',
    title: 'Form',
    readyState: 'complete',
    scrollPercent: 0,
    pageHeightPx: 1000,
    viewport: { width: 1000, height: 800 },
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
}

interface Harness {
  ctx: ToolContext
  registry: ToolRegistry
  acts: ActRequest[]
  nav: string[]
  waits: { condition: string; value: string; timeoutMs: number }[]
}

function harness(vault?: VaultAccess): Harness {
  const acts: ActRequest[] = []
  const nav: string[] = []
  const waits: { condition: string; value: string; timeoutMs: number }[] = []

  const host: ToolHost = {
    async pageState() {
      return pageState()
    },
    async formFields() {
      return []
    },
    async act(_tabId, action) {
      acts.push(action)
      return { ok: true, detail: `did ${action.type}` }
    },
    async locate() {
      return null
    },
    async navigate() {},
    async openTab(url) {
      nav.push(`open ${url}`)
      return 77
    },
    async sleep() {},
    review() {},
    ...stubNavigation(nav, {
      async waitFor(_tabId, condition, value, timeoutMs) {
        waits.push({ condition, value, timeoutMs })
        return { ok: true, detail: `saw ${condition}` }
      },
    }),
  }

  const ctx: ToolContext = {
    host,
    tabId: 1,
    signal: new AbortController().signal,
    ...(vault === undefined ? {} : { vault }),
  }
  return {
    ctx,
    registry: new ToolRegistry(coreTools()),
    acts,
    nav,
    waits,
  }
}

function unlocked(profile: Profile): VaultAccess {
  const meta: ProfileMeta = {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    updatedAt: profile.updatedAt,
    filled: 1,
  }
  return {
    isUnlocked: true,
    async list() {
      return [meta]
    },
    async get(id) {
      return id === profile.id ? profile : null
    },
  }
}

function withDocument(text?: string): Profile {
  const profile = emptyProfile('p1', 'Work')
  profile.documents.push({ fileName: 'resume.pdf', kind: 'resume', ...(text === undefined ? {} : { text }) })
  return profile
}

describe('tool list', () => {
  it('exposes the interaction and navigation verbs', () => {
    const names = coreTools().map((tool) => tool.name)
    for (const name of [
      'hover',
      'press_key',
      'select_option',
      'check',
      'upload_file',
      'drag_and_drop',
      'go_back',
      'go_forward',
      'reload',
      'open_tab',
      'wait_for',
    ]) {
      expect(names).toContain(name)
    }
  })
})

describe('element verbs', () => {
  it('passes the index through to the page', async () => {
    const h = harness()
    await expect(h.registry.execute('hover', { index: 5 }, h.ctx)).resolves.toMatchObject({ ok: true })
    expect(h.acts).toEqual([{ type: 'hover', index: 5 }])
  })

  it('omits the index when press_key aims at the focused control', async () => {
    const h = harness()
    await h.registry.execute('press_key', { key: 'Enter' }, h.ctx)
    expect(h.acts).toEqual([{ type: 'press_key', key: 'Enter' }])
  })

  it('maps check state and select value onto the request', async () => {
    const h = harness()
    await h.registry.execute('check', { index: 2, state: false }, h.ctx)
    await h.registry.execute('select_option', { index: 3, value: 'Germany' }, h.ctx)
    expect(h.acts).toEqual([
      { type: 'check', index: 2, checked: false },
      { type: 'select', index: 3, value: 'Germany' },
    ])
  })

  it('keeps both ends of a drag', async () => {
    const h = harness()
    await h.registry.execute('drag_and_drop', { from_index: 4, to_index: 9 }, h.ctx)
    expect(h.acts).toEqual([{ type: 'drag', fromIndex: 4, toIndex: 9 }])
  })

  it('refuses arguments that cannot name a control', async () => {
    const h = harness()
    expect((await h.registry.execute('hover', { index: -1 }, h.ctx)).ok).toBe(false)
    expect((await h.registry.execute('check', { index: 1 }, h.ctx)).ok).toBe(false)
    expect((await h.registry.execute('drag_and_drop', { from_index: 1 }, h.ctx)).ok).toBe(false)
    expect(h.acts).toEqual([])
  })

  it('carries the control back for the audit log', async () => {
    const h = harness()
    const target = {
      label: 'Country',
      role: 'combobox' as const,
      inputType: null,
      selector: {
        css: '#country',
        xpath: '/html/body/select',
        textAnchor: 'Country',
        bbox: { x: 0, y: 0, width: 10, height: 10 },
        tag: 'select',
        role: 'combobox' as const,
        frameUrl: null,
      },
    }
    h.ctx.host = { ...h.ctx.host, act: async () => ({ ok: true, detail: 'done', target }) }
    const result = await h.registry.execute('select_option', { index: 3, value: 'Germany' }, h.ctx)
    expect(result.target).toEqual(target)
  })
})

describe('upload_file', () => {
  it('refuses while the vault is locked', async () => {
    const h = harness()
    const result = await h.registry.execute('upload_file', { index: 4, file_ref: 'resume.pdf' }, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('vault is locked')
    expect(h.acts).toEqual([])
  })

  it('names the stored documents when the reference misses', async () => {
    const h = harness(unlocked(withDocument('A. Candidate')))
    const result = await h.registry.execute('upload_file', { index: 4, file_ref: 'cover.pdf' }, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('resume.pdf')
  })

  it('does not attach a document whose contents were never saved', async () => {
    const h = harness(unlocked(withDocument()))
    const result = await h.registry.execute('upload_file', { index: 4, file_ref: 'resume.pdf' }, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('name only')
    expect(h.acts).toEqual([])
  })

  it('attaches the stored text as a file', async () => {
    const h = harness(unlocked(withDocument('A. Candidate, two decades of heat pumps')))
    const result = await h.registry.execute('upload_file', { index: 4, file_ref: 'resume' }, h.ctx)
    expect(result.ok).toBe(true)
    expect(h.acts).toEqual([
      {
        type: 'upload',
        index: 4,
        file: {
          name: 'resume.pdf',
          mime: 'application/pdf',
          text: 'A. Candidate, two decades of heat pumps',
        },
      },
    ])
  })
})

describe('pickStoredDocument', () => {
  it('matches the file name first, then the kind', () => {
    const profile = withDocument('text')
    expect(pickStoredDocument(profile, 'RESUME.pdf')?.kind).toBe('resume')
    expect(pickStoredDocument(profile, 'resume')?.fileName).toBe('resume.pdf')
    expect(pickStoredDocument(profile, 'cover-letter')).toBeNull()
  })
})

describe('navigation', () => {
  it('moves through the tab history', async () => {
    const h = harness()
    await h.registry.execute('go_back', {}, h.ctx)
    await h.registry.execute('go_forward', {}, h.ctx)
    await h.registry.execute('reload', {}, h.ctx)
    expect(h.nav).toEqual(['go_back', 'go_forward', 'reload'])
  })

  it('opens a background tab with a scheme filled in', async () => {
    const h = harness()
    const result = await h.registry.execute('open_tab', { url: 'example.com/jobs' }, h.ctx)
    expect(result.content).toContain('tab 77')
    expect(h.nav).toEqual(['open https://example.com/jobs'])
  })

  it('rejects an empty url', async () => {
    const h = harness()
    expect((await h.registry.execute('open_tab', { url: '  ' }, h.ctx)).ok).toBe(false)
  })
})

describe('wait_for', () => {
  it('waits for the tab itself to finish loading', async () => {
    const h = harness()
    const result = await h.registry.execute('wait_for', { condition: 'load', timeout_seconds: 3 }, h.ctx)
    expect(result.ok).toBe(true)
    expect(h.nav).toEqual(['wait_for load'])
    expect(h.waits).toEqual([])
  })

  it('asks the page for a selector, text, or a still DOM', async () => {
    const h = harness()
    await h.registry.execute('wait_for', { condition: 'selector', value: '#done' }, h.ctx)
    await h.registry.execute('wait_for', { condition: 'quiet' }, h.ctx)
    expect(h.waits).toEqual([
      { condition: 'selector', value: '#done', timeoutMs: 10_000 },
      { condition: 'quiet', value: '', timeoutMs: 10_000 },
    ])
  })

  it('does not send a selector wait with nothing to look for', async () => {
    const h = harness()
    const result = await h.registry.execute('wait_for', { condition: 'text' }, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('needs a value')
    expect(h.waits).toEqual([])
  })

  it('rejects a condition the page cannot answer', async () => {
    const h = harness()
    expect((await h.registry.execute('wait_for', { condition: 'network_idle' }, h.ctx)).ok).toBe(false)
    expect((await h.registry.execute('wait_for', { condition: 'load', timeout_seconds: 600 }, h.ctx)).ok).toBe(false)
  })
})
