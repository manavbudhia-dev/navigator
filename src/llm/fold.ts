import type {
  ChatMessage,
  CompletionChunk,
  CompletionResult,
  TokenUsage,
  ToolCall,
} from './types'

interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

/**
 * Folds a provider's chunk stream into one assistant message, reassembling
 * tool-call argument JSON that arrives split across deltas.
 */
export async function foldStream(
  chunks: AsyncIterable<CompletionChunk>,
): Promise<CompletionResult> {
  let text = ''
  const toolCalls = new Map<number, ToolCallAccumulator>()
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 }
  let finishReason: string | null = null

  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'text':
        text += chunk.text
        break
      case 'tool-call-delta': {
        const delta = chunk.toolCall
        const existing = toolCalls.get(delta.index) ?? { id: '', name: '', arguments: '' }
        if (delta.id) existing.id = delta.id
        if (delta.name) existing.name = delta.name
        if (delta.argumentsDelta) existing.arguments += delta.argumentsDelta
        if (delta.arguments) existing.arguments = delta.arguments
        toolCalls.set(delta.index, existing)
        break
      }
      case 'usage':
        usage = chunk.usage
        break
      case 'done':
        finishReason = chunk.finishReason
        break
    }
  }

  const calls: ToolCall[] = Array.from(toolCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({ id: call.id, name: call.name, arguments: call.arguments }))

  const message: ChatMessage = {
    role: 'assistant',
    content: text === '' ? null : text,
    ...(calls.length > 0 ? { toolCalls: calls } : {}),
  }

  return { message, usage, finishReason }
}
