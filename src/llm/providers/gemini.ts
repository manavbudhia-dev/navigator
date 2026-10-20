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
} from '../types'

/**
 * Gemini generateContent API. System prompts become systemInstruction,
 * tool calls are functionCall parts and results are functionResponse parts.
 * Gemini delivers whole function calls in one chunk, not deltas.
 */

export interface GeminiPart {
  text?: string
  functionCall?: { name: string; args: unknown }
  functionResponse?: { name: string; response: unknown }
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export interface GeminiRequest {
  systemInstruction?: { parts: Array<{ text: string }> }
  contents: GeminiContent[]
  tools?: Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> }>
  generationConfig: { temperature: number; maxOutputTokens: number }
}

export function toGeminiRequest(request: CompletionRequest, config: StreamConfig): GeminiRequest {
  const systemParts: string[] = []
  const contents: GeminiContent[] = []

  const pushToolResponses = (message: ChatMessage): void => {
    const part: GeminiPart = {
      functionResponse: {
        name: toolNameFor(message),
        response: { result: message.content ?? '' },
      },
    }
    const last = contents[contents.length - 1]
    if (last && last.role === 'user' && last.parts.some((p) => p.functionResponse)) {
      last.parts.push(part)
    } else {
      contents.push({ role: 'user', parts: [part] })
    }
  }

  for (const message of request.messages) {
    if (message.role === 'system') {
      if (message.content) systemParts.push(message.content)
      continue
    }
    if (message.role === 'tool') {
      pushToolResponses(message)
      continue
    }
    if (message.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (message.content) parts.push({ text: message.content })
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: safeParse(call.arguments) } })
      }
      contents.push({ role: 'model', parts })
      continue
    }
    contents.push({ role: 'user', parts: [{ text: message.content ?? '' }] })
  }

  return {
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts.map((text) => ({ text })) } } : {}),
    contents,
    ...(request.tools
      ? {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ],
        }
      : {}),
    generationConfig: {
      temperature: request.temperature ?? config.temperature,
      maxOutputTokens: request.maxTokens ?? config.maxTokens,
    },
  }
}

/** Gemini tool results echo the function name; we carry it in toolCallId's sibling field. */
function toolNameFor(message: ChatMessage): string {
  return message.name ?? 'tool'
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini' as const

  async *stream(
    request: CompletionRequest,
    config: StreamConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<CompletionChunk> {
    const base = config.baseUrl.replace(/\/+$/, '')
    const url = `${base}/models/${encodeURIComponent(config.modelName)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toGeminiRequest(request, config)),
      ...(signal ? { signal } : {}),
    })

    if (!response.ok) throw await llmErrorFromResponse(response, this.id)

    let finishReason: string | null = null
    let usage: { promptTokens: number; completionTokens: number } | null = null
    let toolIndex = 0

    for await (const line of sseLines(response)) {
      const payload = sseData(line)
      if (payload === null) continue

      const chunk = JSON.parse(payload) as GeminiChunk
      const candidate = chunk.candidates?.[0]

      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) yield { type: 'text', text: part.text }
        if (part.functionCall) {
          yield {
            type: 'tool-call-delta',
            toolCall: {
              index: toolIndex,
              id: `gemini-${toolIndex}`,
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            },
          }
          toolIndex += 1
        }
      }

      if (candidate?.finishReason) finishReason = candidate.finishReason
      if (chunk.usageMetadata) {
        usage = {
          promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
        }
      }
    }

    if (usage) yield { type: 'usage', usage }
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
