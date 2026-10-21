import type { z } from 'zod'

import type { ActRequest, ActResult } from '@/types/actions'
import type { PageState } from '@/types/pageState'
import type { Profile, ProfileMeta } from '@/types/vault'
import type { FormFieldView } from '@/content/formFields'
import type { ChatMessage, CompletionResult } from '@/llm/types'

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
  formFields(tabId: number): Promise<FormFieldView[]>
  act(tabId: number, action: ActRequest): Promise<ActResult>
  navigate(tabId: number, url: string): Promise<void>
  openTab(url: string): Promise<number>
  sleep(ms: number, signal: AbortSignal): Promise<void>
  /** Draw red "needs you" boxes on the page. Fire and forget. */
  review(tabId: number, indices: number[]): void
}

/** Read-only view of the unlocked profile vault. */
export interface VaultAccess {
  readonly isUnlocked: boolean
  list(): Promise<ProfileMeta[]>
  get(id: string): Promise<Profile | null>
}

export interface ToolContext {
  host: ToolHost
  tabId: number
  signal: AbortSignal
  /**
   * One-shot model call for tools that need judgement (form mapping). Injected
   * by the loop so the tool never imports the LLM layer itself.
   */
  complete?(messages: ChatMessage[], kind: 'big' | 'small'): Promise<CompletionResult>
  vault?: VaultAccess
}

export interface ToolSpec<S extends z.ZodType = z.ZodType> {
  name: string
  description: string
  kind: ToolKind
  schema: S
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>
}
