import { configForKind, toStreamConfig, type ModelConfig } from './config'
import { foldStream } from './fold'
import { AnthropicProvider } from './providers/anthropic'
import { GeminiProvider } from './providers/gemini'
import { OpenAICompatibleProvider } from './providers/openai'
import {
  LLMError,
  type CompletionChunk,
  type CompletionRequest,
  type CompletionResult,
  type LLMProvider,
  type ProviderId,
} from './types'

const PROVIDERS: Record<ProviderId, LLMProvider> = {
  openai: new OpenAICompatibleProvider(),
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider(),
}

export function getProvider(id: ProviderId): LLMProvider {
  const provider = PROVIDERS[id]
  if (!provider) throw new LLMError(`Unknown provider: ${id}`)
  return provider
}

export interface CompleteOptions {
  kind?: 'big' | 'small'
  signal?: AbortSignal
}

/** Streams chunks from the configured provider for one model turn. */
export function streamChat(
  request: CompletionRequest,
  config: ModelConfig,
  options: CompleteOptions = {},
): AsyncGenerator<CompletionChunk> {
  const resolved = configForKind(config, options.kind ?? 'big')
  return getProvider(resolved.provider).stream(request, toStreamConfig(resolved), options.signal)
}

/** One full model turn, tool calls reassembled from deltas. */
export function complete(
  request: CompletionRequest,
  config: ModelConfig,
  options: CompleteOptions = {},
): Promise<CompletionResult> {
  return foldStream(streamChat(request, config, options))
}

export { foldStream } from './fold'
export { LLMError } from './types'
export type {
  ChatMessage,
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  JsonSchema,
  LLMProvider,
  ProviderId,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from './types'
export type { ModelConfig } from './config'
