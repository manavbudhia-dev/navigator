/** Safety modes from spec §9 — how much autonomy the agent has. */
export type AgentMode = 'observe' | 'copilot' | 'auto'

export const AGENT_MODES: readonly AgentMode[] = ['observe', 'copilot', 'auto'] as const

export const MODE_LABELS: Record<AgentMode, string> = {
  observe: 'Observe (read-only)',
  copilot: 'Co-pilot (approve each write)',
  auto: 'Auto (autonomous, allowlisted)',
}
