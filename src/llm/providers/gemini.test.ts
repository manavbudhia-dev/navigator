import { describe, expect, it } from 'vitest'

import { toGeminiRequest } from './gemini'

import type { StreamConfig } from '../types'

const config: StreamConfig = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'test-key',
  modelName: 'gemini-2.5-pro',
  temperature: 0.4,
  maxTokens: 8192,
}

describe('toGeminiRequest', () => {
  it('turns system messages into systemInstruction and maps roles', () => {
    const request = toGeminiRequest(
      {
        messages: [
          { role: 'system', content: 'You are Navigator.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
      },
      config,
    )

    expect(request.systemInstruction).toEqual({ parts: [{ text: 'You are Navigator.' }] })
    expect(request.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi there' }] },
    ])
    expect(request.generationConfig).toEqual({ temperature: 0.4, maxOutputTokens: 8192 })
  })

  it('omits systemInstruction when there are no system messages', () => {
    const request = toGeminiRequest(
      { messages: [{ role: 'user', content: 'Hello' }] },
      config,
    )
    expect('systemInstruction' in request).toBe(false)
  })

  it('converts assistant tool calls to functionCall parts', () => {
    const request = toGeminiRequest(
      {
        messages: [
          {
            role: 'assistant',
            content: 'Working',
            toolCalls: [{ id: 'g1', name: 'click', arguments: '{"index":2}' }],
          },
        ],
      },
      config,
    )

    expect(request.contents[0]).toEqual({
      role: 'model',
      parts: [
        { text: 'Working' },
        { functionCall: { name: 'click', args: { index: 2 } } },
      ],
    })
  })

  it('merges consecutive tool results into functionResponse parts', () => {
    const request = toGeminiRequest(
      {
        messages: [
          { role: 'user', content: 'Do two things' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [
              { id: 'g1', name: 'click', arguments: '{}' },
              { id: 'g2', name: 'type_text', arguments: '{}' },
            ],
          },
          { role: 'tool', content: 'clicked', toolCallId: 'g1', name: 'click' },
          { role: 'tool', content: 'typed', toolCallId: 'g2', name: 'type_text' },
        ],
      },
      config,
    )

    expect(request.contents).toHaveLength(3)
    expect(request.contents[2]).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { name: 'click', response: { result: 'clicked' } } },
        { functionResponse: { name: 'type_text', response: { result: 'typed' } } },
      ],
    })
  })

  it('wraps tool definitions in functionDeclarations', () => {
    const request = toGeminiRequest(
      {
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          {
            name: 'navigate',
            description: 'Open a URL',
            parameters: { type: 'object', properties: { url: { type: 'string' } } },
          },
        ],
      },
      config,
    )

    expect(request.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'navigate',
            description: 'Open a URL',
            parameters: { type: 'object', properties: { url: { type: 'string' } } },
          },
        ],
      },
    ])
  })
})
