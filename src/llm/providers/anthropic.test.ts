import { describe, expect, it } from 'vitest'

import { toAnthropicRequest } from './anthropic'

import type { StreamConfig } from '../types'

const config: StreamConfig = {
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'test-key',
  modelName: 'claude-sonnet-4-5',
  temperature: 0.3,
  maxTokens: 2048,
}

describe('toAnthropicRequest', () => {
  it('hoists system messages to the top-level system field', () => {
    const request = toAnthropicRequest(
      {
        messages: [
          { role: 'system', content: 'You are Navigator.' },
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'Hello' },
        ],
      },
      config,
    )

    expect(request.system).toBe('You are Navigator.\n\nBe concise.')
    expect(request.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ])
    expect(request.model).toBe('claude-sonnet-4-5')
    expect(request.temperature).toBe(0.3)
    expect(request.max_tokens).toBe(2048)
    expect(request.stream).toBe(true)
  })

  it('omits system when there are no system messages', () => {
    const request = toAnthropicRequest(
      { messages: [{ role: 'user', content: 'Hello' }] },
      config,
    )
    expect('system' in request).toBe(false)
  })

  it('converts assistant tool calls to tool_use blocks with parsed input', () => {
    const request = toAnthropicRequest(
      {
        messages: [
          { role: 'user', content: 'Click it' },
          {
            role: 'assistant',
            content: 'Sure',
            toolCalls: [{ id: 'tu_1', name: 'click', arguments: '{"index":4}' }],
          },
        ],
      },
      config,
    )

    expect(request.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Sure' },
        { type: 'tool_use', id: 'tu_1', name: 'click', input: { index: 4 } },
      ],
    })
  })

  it('merges consecutive tool results into one user turn of tool_result blocks', () => {
    const request = toAnthropicRequest(
      {
        messages: [
          { role: 'user', content: 'Do two things' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [
              { id: 'tu_1', name: 'click', arguments: '{}' },
              { id: 'tu_2', name: 'type_text', arguments: '{}' },
            ],
          },
          { role: 'tool', content: 'clicked', toolCallId: 'tu_1' },
          { role: 'tool', content: 'typed', toolCallId: 'tu_2' },
        ],
      },
      config,
    )

    expect(request.messages).toHaveLength(3)
    expect(request.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'clicked' },
        { type: 'tool_result', tool_use_id: 'tu_2', content: 'typed' },
      ],
    })
  })

  it('maps tool definitions to input_schema', () => {
    const request = toAnthropicRequest(
      {
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          {
            name: 'scroll',
            description: 'Scroll the page',
            parameters: { type: 'object', properties: { direction: { type: 'string' } } },
          },
        ],
      },
      config,
    )

    expect(request.tools).toEqual([
      {
        name: 'scroll',
        description: 'Scroll the page',
        input_schema: { type: 'object', properties: { direction: { type: 'string' } } },
      },
    ])
  })
})
