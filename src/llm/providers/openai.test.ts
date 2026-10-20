import { describe, expect, it, vi } from 'vitest'

import { OpenAICompatibleProvider, toOpenAIRequest } from './openai'

import type { StreamConfig } from '../types'

const config: StreamConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  modelName: 'qwen3-max',
  temperature: 0.2,
  maxTokens: 4096,
}

function sseResponse(events: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

describe('toOpenAIRequest', () => {
  it('maps messages, tools and streaming options', () => {
    const request = toOpenAIRequest(
      {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [{ id: 'c1', name: 'click', arguments: '{"index":3}' }],
          },
          { role: 'tool', content: 'clicked', toolCallId: 'c1' },
        ],
        tools: [
          {
            name: 'click',
            description: 'Click an element',
            parameters: { type: 'object', properties: { index: { type: 'number' } } },
          },
        ],
      },
      config,
    )

    expect(request.model).toBe('qwen3-max')
    expect(request.stream).toBe(true)
    expect(request.stream_options).toEqual({ include_usage: true })
    expect(request.temperature).toBe(0.2)
    expect(request.max_tokens).toBe(4096)

    const messages = request.messages as Array<Record<string, unknown>>
    expect(messages).toHaveLength(4)
    expect(messages[2]!.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'click', arguments: '{"index":3}' } },
    ])
    expect(messages[3]).toEqual({ role: 'tool', content: 'clicked', tool_call_id: 'c1' })

    const tools = request.tools as Array<Record<string, unknown>>
    expect(tools[0]!.type).toBe('function')
  })
})

describe('OpenAICompatibleProvider.stream', () => {
  it('folds text deltas, split tool calls and usage into a result', async () => {
    const events = [
      JSON.stringify({ choices: [{ delta: { content: 'Let me ' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'click that.' } }] }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'click' } }] } }],
      }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"ind' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ex":7}' } }] } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } }),
      '[DONE]',
    ]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(events)))
    try {
      const provider = new OpenAICompatibleProvider()
      const result = await provider.complete(
        { messages: [{ role: 'user', content: 'click the button' }] },
        config,
      )

      expect(result.message.role).toBe('assistant')
      expect(result.message.content).toBe('Let me click that.')
      expect(result.message.toolCalls).toEqual([
        { id: 'call_1', name: 'click', arguments: '{"index":7}' },
      ])
      expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 8 })
      expect(result.finishReason).toBe('tool_calls')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends the bearer token and hits /chat/completions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['[DONE]']))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const provider = new OpenAICompatibleProvider()
      await provider.complete({ messages: [{ role: 'user', content: 'hi' }] }, config)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
        }),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws an LLMError with the server message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }),
      ),
    )
    try {
      const provider = new OpenAICompatibleProvider()
      await expect(
        provider.complete({ messages: [{ role: 'user', content: 'hi' }] }, config),
      ).rejects.toThrow(/bad key/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
