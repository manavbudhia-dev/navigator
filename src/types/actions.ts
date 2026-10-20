/**
 * One browser action the agent wants to perform on a tab (spec §4/§5).
 * Elements are addressed by the index shown in the page-state spec lines,
 * so the LLM never needs selectors.
 */
export type ActRequest =
  | { type: 'click'; index: number }
  | { type: 'type'; index: number; text: string; submit?: boolean }
  | { type: 'scroll'; direction: 'down' | 'up'; amount?: number; index?: number }

export type ActOutcome = {
  ok: true
  /** Human-readable summary of what happened, for the transcript. */
  detail: string
  /** True when the DOM event path could not finish the job — background should retry via CDP. */
  fellBack?: boolean
}

export type ActFailure = {
  ok: false
  error: string
}

export type ActResult = ActOutcome | ActFailure
