import type { z } from 'zod'

import type { ActRequest, ActResult, ActTarget } from '@/types/actions'
import type { PageState } from '@/types/pageState'
import type { Profile, ProfileMeta } from '@/types/vault'
import type { FormFieldView } from '@/content/formFields'
import type { WaitCondition } from '@/content/waitFor'
import type { ChatMessage, CompletionResult } from '@/llm/types'
import type { TabIntent, TabReport } from '@/tabs/types'

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
  /**
   * The control this call touched, when it touched one. Only the audit log
   * and recipes see it — never the transcript (spec §11).
   */
  target?: ActTarget
}

export interface ToolHost {
  pageState(tabId: number, includeOffViewport?: boolean): Promise<PageState>
  formFields(tabId: number): Promise<FormFieldView[]>
  act(tabId: number, action: ActRequest): Promise<ActResult>
  /**
   * Where a remembered control lives in the *current* snapshot, or null when
   * the page moved on. Only recipe replay needs it (spec §11).
   */
  locate(tabId: number, target: ActTarget): Promise<number | null>
  navigate(tabId: number, url: string): Promise<void>
  openTab(url: string): Promise<number>
  goBack(tabId: number): Promise<void>
  goForward(tabId: number): Promise<void>
  reload(tabId: number): Promise<void>
  /** Ask the page itself to wait for a selector, text, or a still DOM. */
  waitFor(tabId: number, condition: WaitCondition, value: string, timeoutMs: number): Promise<ActResult>
  /** True when the tab reached "complete" before the timeout ran out. */
  waitForLoad(tabId: number, timeoutMs: number): Promise<boolean>
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

/**
 * The tab manager (spec §8), injected by the loop so tab tools stay in the
 * registry like every other capability. `guard.keepIds` protects the tab the
 * agent is working in from a bulk close.
 */
export interface TabOps {
  run(
    intent: TabIntent,
    options?: { guard?: { keepIds: number[] }; signal?: AbortSignal },
  ): Promise<TabReport>
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
  tabs?: TabOps
}

export interface ToolSpec<S extends z.ZodType = z.ZodType> {
  name: string
  description: string
  kind: ToolKind
  schema: S
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>
}
