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
  type ToolDefinition,
} from '../types'

/**
 * Anthropic Messages API. System prompts move to the top-level `system`
 * field and tool results become `tool_result` blocks inside user turns.
 */

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

export interface AnthropicRequest {
  model: string
  system?: string
  messages: AnthropicMessage[]
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
  temperature: number
  max_tokens: number
  stream: true
}

export function toAnthropicRequest(request: CompletionRequest, config: StreamConfig): AnthropicRequest {
  const systemParts: string[] = []
  const messages: AnthropicMessage[] = []

  for (const message of request.messages) {
    if (message.role === 'system') {
      if (message.content) systemParts.push(message.content)
      continue
    }

    if (message.role === 'tool') {
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: message.content ?? '',
      }
      const last = messages[messages.length - 1]
      if (last && last.role === 'user' && last.content.some((b) => b.type === 'tool_result')) {
        last.content.push(block)
      } else {
        messages.push({ role: 'user', content: [block] })
      }
      continue
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: safeParse(call.arguments),
        })
      }
      messages.push({ role: 'assistant', content: blocks })
      continue
    }

    messages.push({
      role: 'user',
      content: [{ type: 'text', text: message.content ?? '' }],
    })
  }

  return {
    model: config.modelName,
    ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
    messages,
    ...(request.tools
      ? {
          tools: request.tools.map((tool: ToolDefinition) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters,
          })),
        }
      : {}),
    temperature: request.temperature ?? config.temperature,
    max_tokens: request.maxTokens ?? config.maxTokens,
    stream: true,
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}

interface AnthropicEvent {
  type: string
  index?: number
  content_block?: { type: string; id?: string; name?: string }
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string | null }
  usage?: { input_tokens?: number; output_tokens?: number }
  message?: { usage?: { input_tokens?: number } }
}

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const

  async *stream(
    request: CompletionRequest,
    config: StreamConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<CompletionChunk> {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/messages`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        // Required: Anthropic blocks browser origins unless this is set.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(toAnthropicRequest(request, config)),
      ...(signal ? { signal } : {}),
    })

    if (!response.ok) throw await llmErrorFromResponse(response, this.id)

    let promptTokens = 0
    let completionTokens = 0
    let finishReason: string | null = null

    for await (const line of sseLines(response)) {
      const payload = sseData(line)
      if (payload === null) continue

      const event = JSON.parse(payload) as AnthropicEvent
      switch (event.type) {
        case 'message_start':
          promptTokens = event.message?.usage?.input_tokens ?? 0
          break
        case 'content_block_start': {
          const block = event.content_block
          if (block?.type === 'tool_use' && event.index !== undefined && block.id && block.name) {
            yield {
              type: 'tool-call-delta',
              toolCall: { index: event.index, id: block.id, name: block.name },
            }
          }
          break
        }
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { type: 'text', text: event.delta.text }
          } else if (event.delta?.type === 'input_json_delta' && event.index !== undefined) {
            yield {
              type: 'tool-call-delta',
              toolCall: { index: event.index, argumentsDelta: event.delta.partial_json ?? '' },
            }
          }
          break
        case 'message_delta':
          finishReason = event.delta?.stop_reason ?? finishReason
          completionTokens = event.usage?.output_tokens ?? completionTokens
          break
        case 'message_stop':
          break
      }
    }

    yield { type: 'usage', usage: { promptTokens, completionTokens } }
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
