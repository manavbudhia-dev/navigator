import type { z } from 'zod'

import type { ActRequest, ActResult } from '@/types/actions'
import type { PageState } from '@/types/pageState'

/**
 * Tool contract (spec §4). The LLM sees name + description + JSON Schema;
 * the background sees `run`. Everything a tool can do to the browser goes
 * through ToolHost, so the registry stays testable without Chrome.
 */

export type ToolKind = 'read' | 'write' | 'control'

export interface ToolResult {
  ok: boolean
  /** Text returned to the model as the tool message. */
  content: string
}

export interface ToolHost {
  pageState(tabId: number, includeOffViewport?: boolean): Promise<PageState>
  act(tabId: number, action: ActRequest): Promise<ActResult>
  navigate(tabId: number, url: string): Promise<void>
  openTab(url: string): Promise<number>
  sleep(ms: number, signal: AbortSignal): Promise<void>
}

export interface ToolContext {
  host: ToolHost
  tabId: number
  signal: AbortSignal
}

export interface ToolSpec<S extends z.ZodType = z.ZodType> {
  name: string
  description: string
  kind: ToolKind
  schema: S
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>
}
