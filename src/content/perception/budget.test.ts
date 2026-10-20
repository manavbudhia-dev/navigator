import { describe, expect, it } from 'vitest'

import { applyTokenBudget, estimateTokens } from './budget'
import { serializeElement } from './indexer'
import type { IndexedElement } from '@/types/pageState'

function element(index: number, text: string, inViewport: boolean): IndexedElement {
  return {
    index,
    tag: 'button',
    role: 'button',
    attributes: {},
    text,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    inViewport,
    selector: {
      css: 'button',
      xpath: '/button',
      textAnchor: text,
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      tag: 'button',
      role: 'button',
      frameUrl: null,
    },
  }
}

const ELEMENTS = [
  element(0, 'In one', true),
  element(1, 'In two', true),
  element(2, 'Off one', false),
  element(3, 'Off two', false),
]

describe('applyTokenBudget', () => {
  it('keeps viewport elements first and drops off-viewport ones under pressure', () => {
    const out = applyTokenBudget({
      elements: ELEMENTS,
      serialize: serializeElement,
      markdown: 'word '.repeat(4000),
      metaText: 'URL: x',
      budget: 30,
    })

    expect(out.elementLines.join('\n')).toContain('In one')
    expect(out.elementLines.join('\n')).toContain('In two')
    expect(out.elementLines.join('\n')).not.toContain('Off one')
    expect(out.truncatedElements).toBe(true)
    expect(out.truncatedMarkdown).toBe(true)
  })

  it('keeps everything and stays within budget when there is room', () => {
    const out = applyTokenBudget({
      elements: ELEMENTS,
      serialize: serializeElement,
      markdown: '# Title\n\nSome content.',
      metaText: 'URL: x',
      budget: 4000,
    })

    expect(out.elementLines).toHaveLength(4)
    expect(out.truncatedElements).toBe(false)
    expect(out.truncatedMarkdown).toBe(false)
    expect(out.tokenEstimate).toBeLessThanOrEqual(4000)
  })

  it('truncates markdown at a line boundary', () => {
    const markdown = Array.from({ length: 200 }, (_, i) => `Line ${i} of content`).join('\n\n')
    const out = applyTokenBudget({
      elements: [],
      serialize: serializeElement,
      markdown,
      metaText: 'URL: x',
      budget: 200,
    })

    expect(out.truncatedMarkdown).toBe(true)
    expect(out.markdown.endsWith('…[truncated]')).toBe(true)
    const body = out.markdown.replace('\n…[truncated]', '')
    expect(body.split('\n\n').every((line) => /^Line \d+ of content$/.test(line))).toBe(true)
  })

  it('estimates roughly four characters per token', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})
