import { describe, expect, it, vi } from 'vitest'

import { compactHistory, estimateMessagesTokens } from './compact'

import type { ChatMessage } from '@/llm/types'

function turn(n: number): ChatMessage[] {
  return [
    { role: 'assistant', content: `thinking about step ${n} `.repeat(30) },
    { role: 'tool', content: `result of step ${n} `.repeat(30), toolCallId: `c${n}`, name: 'click' },
  ]
}

describe('estimateMessagesTokens', () => {
  it('grows with content and counts tool calls', () => {
    const small = estimateMessagesTokens([{ role: 'user', content: 'hi' }])
    const big = estimateMessagesTokens([{ role: 'user', content: 'x'.repeat(4000) }])
    expect(big).toBeGreaterThan(small * 10)
  })
})

describe('compactHistory', () => {
  it('leaves short histories alone', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: 'short' },
    ]
    const summarize = vi.fn(async () => 'unused')
    const result = await compactHistory(messages, { contextWindow: 100_000, keep: 4, summarize })
    expect(result.compacted).toBe(false)
    expect(result.messages).toBe(messages)
    expect(summarize).not.toHaveBeenCalled()
  })

  it('replaces the middle with one summary message', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'the goal' },
      ...turn(1),
      ...turn(2),
      ...turn(3),
      ...turn(4),
    ]
    const summarize = vi.fn(async (old: ChatMessage[]) => {
      expect(old.length).toBeGreaterThan(0)
      return '1. read page 2. clicked login'
    })

    const result = await compactHistory(messages, { contextWindow: 200, keep: 4, summarize })
    expect(result.compacted).toBe(true)
    expect(summarize).toHaveBeenCalledOnce()

    expect(result.messages[0]!.content).toBe('sys')
    expect(result.messages[1]!.content).toBe('the goal')
    expect(result.messages[2]!.content).toContain('Summary of earlier steps')
    expect(result.messages[2]!.content).toContain('clicked login')
    // The last `keep` messages survive verbatim.
    expect(result.messages[result.messages.length - 1]!.role).toBe('tool')
    expect(result.messages.length).toBeLessThan(messages.length)
  })

  it('refuses to compact when there is nothing meaningful to fold away', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: 'x'.repeat(2000) },
      { role: 'tool', content: 'y'.repeat(2000), toolCallId: 'c1' },
    ]
    const result = await compactHistory(messages, { contextWindow: 100, keep: 8, summarize: async () => 's' })
    expect(result.compacted).toBe(false)
  })
})
