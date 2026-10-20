import { z } from 'zod'

import type { JsonSchema, ToolDefinition } from '@/llm/types'

import type { ToolContext, ToolSpec } from './types'

/**
 * The single place that knows every tool. The agent loop asks it for the
 * LLM-facing definitions, validates model-supplied arguments against the
 * Zod schema before anything touches the browser, and dispatches.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>()

  constructor(specs: ToolSpec[]) {
    for (const spec of specs) this.tools.set(spec.name, spec)
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name)
  }

  list(): ToolSpec[] {
    return [...this.tools.values()]
  }

  /** Definitions for the LLM request (spec §5a). */
  toToolDefinitions(): ToolDefinition[] {
    return this.list().map((spec) => ({
      name: spec.name,
      description: spec.description,
      parameters: z.toJSONSchema(spec.schema) as unknown as JsonSchema,
    }))
  }

  parseArgs(name: string, raw: unknown): { ok: true; args: unknown } | { ok: false; error: string } {
    const spec = this.tools.get(name)
    if (!spec) return { ok: false, error: `Unknown tool: ${name}` }
    const parsed = spec.schema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : ''
      return { ok: false, error: `Invalid arguments for ${name}. ${where}${first?.message ?? 'validation failed'}` }
    }
    return { ok: true, args: parsed.data }
  }

  async execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<{ ok: boolean; content: string }> {
    const spec = this.tools.get(name)
    if (!spec) return { ok: false, content: `Unknown tool: ${name}` }

    const parsed = this.parseArgs(name, rawArgs)
    if (!parsed.ok) return { ok: false, content: parsed.error }

    try {
      return await spec.run(parsed.args, ctx)
    } catch (error) {
      return { ok: false, content: error instanceof Error ? error.message : String(error) }
    }
  }
}
