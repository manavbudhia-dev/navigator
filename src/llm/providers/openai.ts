import { foldStream } from '../fold'
import { sseData, sseLines } from '../sse'
import {
  llmErrorFromResponse,
  type ChatMessage,
  type CompletionChunk,
  type CompletionRequest,
  type CompletionResult,
  type LLMProvider,
  type StreamConfig,
  type ToolCallDelta,
  type ToolDefinition,
} from '../types'

/**
 * OpenAI-compatible chat completions. Covers Qwen via DashScope, OpenRouter,
 * OpenAI itself, local vLLM and Ollama's /v1 endpoint — they all speak this
 * wire format, so one implementation serves the whole family.
 */

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.toolCalls) {
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      }
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId ?? '',
      }
    }
    return { role: message.role, content: message.content }
  })
}

export function toOpenAITools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

export function toOpenAIRequest(request: CompletionRequest, config: StreamConfig): Record<string, unknown> {
  return {
    model: config.modelName,
    messages: toOpenAIMessages(request.messages),
    ...(request.tools ? { tools: toOpenAITools(request.tools) } : {}),
    temperature: request.temperature ?? config.temperature,
    max_tokens: request.maxTokens ?? config.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  }
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = 'openai' as const

  async *stream(
    request: CompletionRequest,
    config: StreamConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<CompletionChunk> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey !== '' ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(toOpenAIRequest(request, config)),
      ...(signal ? { signal } : {}),
    })

    if (!response.ok) throw await llmErrorFromResponse(response, this.id)

    let finishReason: string | null = null

    for await (const line of sseLines(response)) {
      const payload = sseData(line)
      if (payload === null) continue
      if (payload === '[DONE]') break

      const chunk = JSON.parse(payload) as OpenAIChunk
      const choice = chunk.choices?.[0]

      const content = choice?.delta?.content
      if (content) yield { type: 'text', text: content }

      for (const delta of choice?.delta?.tool_calls ?? []) {
        const toolCall: ToolCallDelta = { index: delta.index }
        if (delta.id !== undefined) toolCall.id = delta.id
        if (delta.function?.name !== undefined) toolCall.name = delta.function.name
        if (delta.function?.arguments !== undefined) toolCall.argumentsDelta = delta.function.arguments
        yield { type: 'tool-call-delta', toolCall }
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
          },
        }
      }
    }

    yield { type: 'done', finishReason }
  }

  async complete(
    request: CompletionRequest,
    config: StreamConfig,
    signal?: AbortSignal,
  ): Promise<CompletionResult> {
    return foldStream(this.stream(request, config, signal))
  }
}
