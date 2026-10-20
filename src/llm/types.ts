/** Provider-neutral chat + tool-calling contract shared by all providers. */

export type ProviderId = 'openai' | 'anthropic' | 'gemini'

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  /** JSON-encoded arguments, exactly as the model emitted them. */
  arguments: string
}

export interface ChatMessage {
  role: MessageRole
  content: string | null
  toolCalls?: ToolCall[]
  toolCallId?: string
  /** Tool-result messages: the function name (Gemini echoes it back). */
  name?: string
}

/** JSON Schema object describing one tool's arguments (built from Zod). */
export type JsonSchema = Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
}

export interface CompletionRequest {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  temperature?: number
  maxTokens?: number
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  argumentsDelta?: string
  /** Providers that deliver whole calls at once (Gemini) set this. */
  arguments?: string
}

export type CompletionChunk =
  | { type: 'text'; text: string }
  | { type: 'tool-call-delta'; toolCall: ToolCallDelta }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; finishReason: string | null }

export interface CompletionResult {
  message: ChatMessage
  usage: TokenUsage
  finishReason: string | null
}

export interface LLMProvider {
  readonly id: ProviderId
  stream(
    request: CompletionRequest,
    config: StreamConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<CompletionChunk>
}

/** The slice of ModelConfig a provider needs to reach its endpoint. */
export interface StreamConfig {
  baseUrl: string
  apiKey: string
  modelName: string
  temperature: number
  maxTokens: number
}

export class LLMError extends Error {
  readonly status: number | null
  readonly provider: ProviderId | 'unknown'

  constructor(message: string, status: number | null = null, provider: ProviderId | 'unknown' = 'unknown') {
    super(message)
    this.name = 'LLMError'
    this.status = status
    this.provider = provider
  }
}

export async function llmErrorFromResponse(response: Response, provider: ProviderId): Promise<LLMError> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 400)
  } catch {
    detail = ''
  }
  return new LLMError(`Provider ${provider} responded ${response.status}: ${detail}`, response.status, provider)
}
