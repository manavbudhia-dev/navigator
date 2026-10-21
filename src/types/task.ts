import type { RiskLevel } from '@/safety/risk'

/**
 * Events the agent loop emits while a task runs. The background broadcasts
 * these to the side panel; the History tab replays them later (Batch 6).
 */
export type TaskEvent =
  | { type: 'started'; goal: string; mode: string }
  | { type: 'step'; n: number }
  | { type: 'thinking'; text: string }
  | { type: 'action'; id: string; tool: string; args: Record<string, unknown>; summary: string }
  | { type: 'approval'; id: string; tool: string; args: Record<string, unknown>; summary: string; level: RiskLevel; reasons: string[]; hardBlock: string | null }
  | { type: 'approval-resolved'; id: string; approved: boolean }
  | { type: 'question'; id: string; question: string }
  | { type: 'question-resolved'; id: string }
  | { type: 'result'; tool: string; ok: boolean; content: string }
  | { type: 'blocked'; tool: string; reason: string }
  | { type: 'note'; text: string }
  | { type: 'recipe'; id: string; name: string; ok: boolean; detail: string; healed: number }
  | { type: 'done'; runId: string; success: boolean; summary: string; steps: number; promptTokens: number; completionTokens: number }
  | { type: 'failed'; error: string }

export interface TaskEventMessage {
  source: 'navigator-task'
  event: TaskEvent
}

export function isTaskEventMessage(value: unknown): value is TaskEventMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as TaskEventMessage).source === 'navigator-task' &&
    typeof (value as TaskEventMessage).event === 'object'
  )
}
