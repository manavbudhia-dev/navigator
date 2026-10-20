import { LLMError } from './types'

/**
 * Splits a streaming response body into trimmed lines, buffering partial
 * lines across network chunks. All three providers speak SSE with slightly
 * different event framing, so this stays framing-agnostic.
 */
export async function* sseLines(response: Response): AsyncGenerator<string> {
  const body = response.body
  if (!body) throw new LLMError('Provider returned an empty stream body')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let breakAt = buffer.indexOf('\n')
      while (breakAt >= 0) {
        const line = buffer.slice(0, breakAt).trim()
        buffer = buffer.slice(breakAt + 1)
        if (line !== '') yield line
        breakAt = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail !== '') yield tail
  } finally {
    reader.releaseLock()
  }
}

/** Parses `data: …` payloads, skipping comments and empty keep-alives. */
export function sseData(line: string): string | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  return payload === '' ? null : payload
}
