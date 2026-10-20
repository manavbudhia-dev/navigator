import type { AgentMode } from '@/types/agent'

import type { RiskAssessment } from './risk'

/**
 * Autonomy policy (spec §9): turns a risk assessment plus the user's chosen
 * mode into a go / ask / no-go decision.
 */

export type Decision = 'allow' | 'require-approval' | 'block'

export function decide(mode: AgentMode, kind: 'read' | 'write' | 'control', assessment: RiskAssessment): Decision {
  if (assessment.hardBlock !== null) return 'require-approval'

  if (kind !== 'write') {
    // Reading the page and control-flow tools are always fine.
    return 'allow'
  }

  switch (mode) {
    case 'observe':
      return 'block'
    case 'copilot':
      return 'require-approval'
    case 'auto':
      return assessment.level === 'high' ? 'require-approval' : 'allow'
  }
}
