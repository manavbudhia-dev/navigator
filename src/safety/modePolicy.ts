import type { SiteContext } from './allowlist'

import type { AgentMode } from '@/types/agent'

import type { RiskAssessment } from './risk'

/**
 * Autonomy policy (spec §9): turns a risk assessment, the page the action is
 * on and the user's chosen mode into a go / ask / no-go decision.
 */

export type Decision = 'allow' | 'require-approval' | 'block'

export function decide(
  mode: AgentMode,
  kind: 'read' | 'write' | 'control',
  assessment: RiskAssessment,
  site: SiteContext,
): Decision {
  if (kind !== 'write') {
    // Reading the page and control-flow tools change nothing, so they are
    // always fine — even on a checkout page, where every write is hard-blocked.
    // Gating reads there meant Auto mode asked permission to look around.
    return 'allow'
  }

  if (assessment.hardBlock !== null) return 'require-approval'

  switch (mode) {
    case 'observe':
      return 'block'
    case 'copilot':
      return 'require-approval'
    case 'auto':
      // The list is the whole promise of Auto mode: a below-high write acts
      // alone only on a site the user allowed. Anywhere else it degrades to
      // asking rather than blocking, so a new site is never a dead end.
      if (assessment.level === 'high') return 'require-approval'
      return site.allowlisted ? 'allow' : 'require-approval'
  }
}

/**
 * Why the site gate stepped in, in the words the approval card shows. Null
 * whenever the site had nothing to do with the decision.
 */
export function autoSiteReason(mode: AgentMode, site: SiteContext): string | null {
  if (mode !== 'auto' || site.allowlisted) return null
  return site.host === ''
    ? 'Auto mode acts alone only on sites you have allowed, and this page is not a plain web page.'
    : `Auto mode asks first on ${site.host}, which you have not allowed.`
}
