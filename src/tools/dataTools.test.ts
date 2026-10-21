import { describe, expect, it } from 'vitest'

import { dataTools } from './dataTools'
import { ToolRegistry } from './registry'
import { stubChromeHost } from './testUtils'
import type { MemoryEntry, NewMemory } from '@/memory/recall'
import type { PageState } from '@/types/pageState'
import type { CaptureResult, MemoryAccess, SaveFileRequest, SaveFileResult, ToolContext, ToolHost } from './types'

/**
 * The Batch 11 data tools (spec §4) at the registry boundary: what the model
 * writes, what the browser side is asked for, and what comes back.
 */

function pageState(): PageState {
  return {
    url: 'https://example.com/jobs',
    title: 'Jobs',
    readyState: 'complete',
    scrollPercent: 0,
    pageHeightPx: 1000,
    viewport: { width: 1000, height: 800 },
    loginState: 'unknown',
    elementLines: ['[0]<a>Apply</a>/a>'],
    elementCount: 1,
    inViewportCount: 1,
    markdown: '# Senior Engineer\nAcme · Berlin · 90k',
    truncatedElements: false,
    truncatedMarkdown: false,
    tokenEstimate: 20,
    capturedAt: 0,
  }
}

interface Harness {
  ctx: ToolContext
  registry: ToolRegistry
  files: SaveFileRequest[]
}

function harness(
  overrides: {
    capture?: (tabId: number) => Promise<CaptureResult | null>
    saveFile?: (request: SaveFileRequest) => Promise<SaveFileResult>
    memory?: MemoryAccess
    complete?: ToolContext['complete']
  } = {},
): Harness {
  const files: SaveFileRequest[] = []
  const host: ToolHost = {
    async pageState() {
      return pageState()
    },
    async formFields() {
      return []
    },
    async act() {
      return { ok: true, detail: 'did something' }
    },
    async locate() {
      return null
    },
    async navigate() {},
    async openTab() {
      return 5
    },
    async sleep() {},
    review() {},
    ...stubChromeHost([], {
      ...(overrides.capture === undefined ? {} : { capture: overrides.capture }),
      async saveFile(request) {
        files.push(request)
        return { ok: true, savedAs: `C:\\Users\\someone\\Downloads\\${('fileName' in request ? request.fileName : '') || 'server-named.pdf'}` }
      },
      ...(overrides.saveFile === undefined ? {} : { saveFile: overrides.saveFile }),
    }),
  }
  const ctx: ToolContext = {
    host,
    tabId: 1,
    signal: new AbortController().signal,
    ...(overrides.memory === undefined ? {} : { memory: overrides.memory }),
    ...(overrides.complete === undefined ? {} : { complete: overrides.complete }),
  }
  return { ctx, registry: new ToolRegistry(dataTools()), files }
}

function fakeMemory(entries: MemoryEntry[] = []): MemoryAccess & { saved: NewMemory[] } {
  const saved: NewMemory[] = []
  return {
    saved,
    async save(input) {
      saved.push(input)
      return { id: 1, at: 1_700_000_000_000, text: input.text, tags: input.tags ?? [], url: input.url ?? '' }
    },
    async recall(query, limit = 8) {
      if (query === '') return entries.slice(0, limit)
      const want = query.toLowerCase()
      return entries.filter((entry) => `${entry.text} ${entry.tags.join(' ')} ${entry.url}`.toLowerCase().includes(want)).slice(0, limit)
    },
  }
}

function completes(text: string): ToolContext['complete'] {
  return async () => ({
    message: { role: 'assistant', content: text },
    usage: { promptTokens: 10, completionTokens: 5 },
    finishReason: 'stop',
  })
}

describe('extract_structured', () => {
  it('sends the fields to the small model and returns the records', async () => {
    const asked: string[][] = []
    const h = harness({
      complete: async (messages) => {
        asked.push(messages.map((m) => m.content ?? ''))
        return {
          message: { role: 'assistant', content: '{"records":[{"item":"job posting","title":"Senior Engineer","salary":"90k"}]}' },
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'stop',
        }
      },
    })
    const result = await h.registry.execute(
      'extract_structured',
      { item: 'job posting', fields: ['title', 'salary'], many: true },
      h.ctx,
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('"title":"Senior Engineer"')
    // The model never sees a field it was not asked for.
    expect(result.content).not.toContain('"item"')
    expect(asked[0]![1]).toContain('Senior Engineer')
  })

  it('reports honestly when the page holds nothing', async () => {
    const h = harness({ complete: completes('{"records":[]}') })
    const result = await h.registry.execute('extract_structured', { item: 'invoice', fields: ['total'] }, h.ctx)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('No invoice found')
  })

  it('fails instead of guessing when no model is wired in', async () => {
    const h = harness()
    const result = await h.registry.execute('extract_structured', { item: 'invoice', fields: ['total'] }, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('model')
  })

  it('needs at least one field', async () => {
    const h = harness({ complete: completes('{}') })
    expect((await h.registry.execute('extract_structured', { item: 'x', fields: [] }, h.ctx)).ok).toBe(false)
  })
})

describe('screenshot', () => {
  it('attaches the picture to the step and tells the model it is for the user', async () => {
    const h = harness()
    const result = await h.registry.execute('screenshot', {}, h.ctx)
    expect(result.ok).toBe(true)
    expect(result.image).toContain('data:image/jpeg;base64,')
    expect(result.content).toContain('1280x720')
    expect(result.content).toContain('not for you')
  })

  it('says so when Chrome will not photograph the tab', async () => {
    const h = harness({ capture: async () => null })
    const result = await h.registry.execute('screenshot', {}, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('switch_tab')
    expect(result.image).toBeUndefined()
  })
})

describe('write_file', () => {
  it('puts the file in the Navigator folder of Downloads', async () => {
    const h = harness()
    const result = await h.registry.execute('write_file', { file_name: 'summary.md', content: '# Done\n' }, h.ctx)
    expect(result.ok).toBe(true)
    expect(h.files[0]).toEqual({ kind: 'text', fileName: 'Navigator/summary.md', text: '# Done\n' })
    expect(result.content).toContain('Downloads')
  })

  it('refuses an extension it should not write', async () => {
    const h = harness()
    const result = await h.registry.execute('write_file', { file_name: 'notes.exe', content: 'x' }, h.ctx)
    expect(result.ok).toBe(false)
    expect(h.files).toEqual([])
  })

  it('passes a Chrome refusal through as a failure', async () => {
    const h = harness({ saveFile: async () => ({ ok: false, error: 'Chrome refused the download.' }) })
    const result = await h.registry.execute('write_file', { file_name: 'a.txt', content: 'x' }, h.ctx)
    expect(result).toEqual({ ok: false, content: 'Chrome refused the download.' })
  })
})

describe('download_file', () => {
  it('takes the name from the URL when the model does not give one', async () => {
    const h = harness()
    const result = await h.registry.execute('download_file', { url: 'https://example.com/invoices/2026-04.pdf' }, h.ctx)
    expect(result.ok).toBe(true)
    expect(h.files[0]).toEqual({
      kind: 'url',
      fileName: 'Navigator/2026-04.pdf',
      url: 'https://example.com/invoices/2026-04.pdf',
    })
  })

  it('will not fetch a javascript: or file: address', async () => {
    const h = harness()
    expect((await h.registry.execute('download_file', { url: 'javascript:alert(1)' }, h.ctx)).ok).toBe(false)
    expect((await h.registry.execute('download_file', { url: 'file:///etc/passwd' }, h.ctx)).ok).toBe(false)
    expect(h.files).toEqual([])
  })

  it('will not fetch a nameless URL without being told a file name', async () => {
    const h = harness()
    const result = await h.registry.execute('download_file', { url: 'https://example.com/download?id=17' }, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('file_name')
  })

  it('refuses an executable even when the page links it', async () => {
    const h = harness()
    const result = await h.registry.execute('download_file', { url: 'https://example.com/driver.exe' }, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('.exe')
  })

  it('decodes a percent-encoded name before guarding it', async () => {
    const h = harness()
    await h.registry.execute('download_file', { url: 'https://example.com/Quarterly%20Report.pdf' }, h.ctx)
    expect(h.files[0]).toMatchObject({ fileName: 'Navigator/Quarterly Report.pdf' })
  })
})

describe('save_to_memory', () => {
  it('stores the note with its tags', async () => {
    const memory = fakeMemory()
    const h = harness({ memory })
    const result = await h.registry.execute(
      'save_to_memory',
      { text: 'The user prefers remote roles inside the EU.', tags: ['Preference', 'jobs'] },
      h.ctx,
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('Remembered')
    expect(memory.saved).toEqual([{ text: 'The user prefers remote roles inside the EU.', tags: ['Preference', 'jobs'] }])
  })

  it('refuses to remember a secret', async () => {
    const memory = fakeMemory()
    const h = harness({ memory })
    const result = await h.registry.execute('save_to_memory', { text: 'Her password is swordfish123' }, h.ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('vault')
    expect(memory.saved).toEqual([])
  })

  it('says when memory is not available', async () => {
    const h = harness()
    expect((await h.registry.execute('save_to_memory', { text: 'a note' }, h.ctx)).content).toContain('not available')
  })
})

describe('recall_memory', () => {
  const entries: MemoryEntry[] = [
    { id: 1, at: 1_700_000_000_000, text: 'Prefers remote roles inside the EU', tags: ['preference'], url: '' },
  ]

  it('returns matching notes and labels them as past notes', async () => {
    const h = harness({ memory: fakeMemory(entries) })
    const result = await h.registry.execute('recall_memory', { query: 'remote' }, h.ctx)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('Prefers remote roles')
    expect(result.content).toContain('#preference')
    expect(result.content).toContain('matched by keyword')
  })

  it('tells the model to ask when nothing matches', async () => {
    const h = harness({ memory: fakeMemory(entries) })
    const result = await h.registry.execute('recall_memory', { query: 'passport number' }, h.ctx)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('Nothing remembered')
  })

  it('needs a query', async () => {
    const h = harness({ memory: fakeMemory() })
    expect((await h.registry.execute('recall_memory', {}, h.ctx)).ok).toBe(false)
  })
})
