import type { ChatMessage } from '@/llm/types'

/**
 * History compaction (spec §5c/§12): long tasks blow past the context
 * window, so old steps are folded into a summary produced by the small
 * model while the system prompt, the goal and the recent turns stay verbatim.
 */

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let chars = 0
  for (const m of messages) {
    chars += (m.content?.length ?? 0) + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0) + 20
  }
  return Math.ceil(chars / 4)
}

export interface CompactOptions {
  contextWindow: number
  /** Recent messages kept verbatim (excluding system + goal). */
  keep: number
  summarize: (old: ChatMessage[]) => Promise<string>
}

/** Returns the same array when under budget; a new, shorter one otherwise. */
export async function compactHistory(
  messages: ChatMessage[],
  options: CompactOptions,
): Promise<{ messages: ChatMessage[]; compacted: boolean }> {
  const budget = Math.floor(options.contextWindow * 0.7)
  if (estimateMessagesTokens(messages) <= budget) return { messages, compacted: false }

  const head = messages.slice(0, 2)
  const tail = messages.slice(-options.keep)
  const middle = messages.slice(2, Math.max(2, messages.length - options.keep))
  if (middle.length < 4) return { messages, compacted: false }

  const summary = await options.summarize(middle)
  return {
    messages: [...head, { role: 'user', content: `Summary of earlier steps:\n${summary}` }, ...tail],
    compacted: true,
  }
}
