import { describe, expect, it, vi } from 'vitest'

import { coreTools, normalizeUrl } from './definitions'
import { ToolRegistry } from './registry'

import type { ActRequest, ActResult } from '@/types/actions'
import type { PageState } from '@/types/pageState'
import type { ToolContext, ToolHost } from './types'

function fakePageState(overrides: Partial<PageState> = {}): PageState {
  return {
    url: 'https://example.com',
    title: 'Example',
    readyState: 'complete',
    scrollPercent: 0,
    pageHeightPx: 1200,
    viewport: { width: 800, height: 600 },
    loginState: 'unknown',
    elementLines: ['[0]<a href="/">Home</a>/a>'],
    elementCount: 1,
    inViewportCount: 1,
    markdown: '# Example',
    truncatedElements: false,
    truncatedMarkdown: false,
    tokenEstimate: 20,
    capturedAt: 0,
    ...overrides,
  }
}

interface Calls {
  acts: ActRequest[]
  navigations: string[]
  sleeps: number[]
  reviews: number[][]
}

function fakeContext(calls: Calls, actResult: ActResult = { ok: true, detail: 'Clicked' }): ToolContext {
  const host: ToolHost = {
    async pageState() {
      return fakePageState()
    },
    async act(_tabId, action) {
      calls.acts.push(action)
      return actResult
    },
    async navigate(_tabId, url) {
      calls.navigations.push(url)
    },
    async openTab(url) {
      calls.navigations.push(url)
      return 42
    },
    async sleep(ms) {
      calls.sleeps.push(ms)
    },
    async formFields() {
      return []
    },
    review(_tabId, indices) {
      calls.reviews.push(indices)
    },
    async locate() {
      return null
    },
  }
  const controller = new AbortController()
  return { host, tabId: 1, signal: controller.signal }
}

function build(): ToolRegistry {
  return new ToolRegistry(coreTools())
}

describe('ToolRegistry', () => {
  it('exposes every core tool to the LLM with a JSON Schema', () => {
    const defs = build().toToolDefinitions()
    expect(defs.map((d) => d.name)).toEqual([
      'read_page',
      'navigate',
      'click',
      'type_text',
      'scroll',
      'wait',
      'ask_user',
      'finish',
      'fill_form',
    ])
    const click = defs.find((d) => d.name === 'click')!
    expect(click.description.length).toBeGreaterThan(10)
    const schema = click.parameters as { type?: string; properties?: Record<string, unknown> }
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties ?? {})).toEqual(['index'])
  })

  it('rejects unknown tools and invalid arguments before anything runs', () => {
    const registry = build()
    expect(registry.parseArgs('teleport', {}).ok).toBe(false)

    const badIndex = registry.parseArgs('click', { index: -3 })
    expect(badIndex.ok).toBe(false)
    if (!badIndex.ok) expect(badIndex.error).toContain('click')

    expect(registry.parseArgs('click', { index: 4 }).ok).toBe(true)
  })

  it('executes click through the host', async () => {
    const calls: Calls = { acts: [], navigations: [], sleeps: [], reviews: [] }
    const result = await build().execute('click', { index: 7 }, fakeContext(calls))
    expect(result).toEqual({ ok: true, content: 'Clicked' })
    expect(calls.acts).toEqual([{ type: 'click', index: 7 }])
  })

  it('surfaces act failures as tool errors', async () => {
    const calls: Calls = { acts: [], navigations: [], sleeps: [], reviews: [] }
    const ctx = fakeContext(calls, { ok: false, error: 'Element 7 is gone.' })
    const result = await build().execute('click', { index: 7 }, ctx)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('gone')
  })

  it('normalizes navigation URLs and adds https when missing', async () => {
    const calls: Calls = { acts: [], navigations: [], sleeps: [], reviews: [] }
    await build().execute('navigate', { url: 'example.com/x' }, fakeContext(calls))
    expect(calls.navigations).toEqual(['https://example.com/x'])
    expect(normalizeUrl('http://localhost:8000')).toBe('http://localhost:8000')
  })

  it('returns the full page text for read_page', async () => {
    const calls: Calls = { acts: [], navigations: [], sleeps: [], reviews: [] }
    const result = await build().execute('read_page', {}, fakeContext(calls))
    expect(result.content).toContain('URL: https://example.com')
    expect(result.content).toContain('[0]<a')
    expect(result.content).toContain('# Example')
  })

  it('keeps host exceptions inside the tool result', async () => {
    const ctx = fakeContext({ acts: [], navigations: [], sleeps: [], reviews: [] })
    vi.spyOn(ctx.host, 'pageState').mockRejectedValue(new Error('no content script'))
    const result = await build().execute('read_page', {}, ctx)
    expect(result).toEqual({ ok: false, content: 'no content script' })
  })
})
