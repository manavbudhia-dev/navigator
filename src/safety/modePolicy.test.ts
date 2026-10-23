import { describe, expect, it } from 'vitest'

import { autoSiteReason, decide } from './modePolicy'

import type { SiteContext } from './allowlist'
import type { RiskAssessment } from './risk'

const safe: RiskAssessment = { level: 'safe', reasons: [], hardBlock: null }
const medium: RiskAssessment = { level: 'medium', reasons: [], hardBlock: null }
const high: RiskAssessment = { level: 'high', reasons: [], hardBlock: null }
const blocked: RiskAssessment = { level: 'medium', reasons: [], hardBlock: 'payment' }

function site(allowlisted: boolean): SiteContext {
  return { host: 'shop.test', allowlisted }
}

describe('decide', () => {
  it('observe mode allows reads but blocks every write', () => {
    expect(decide('observe', 'read', safe, site(true))).toBe('allow')
    expect(decide('observe', 'write', safe, site(true))).toBe('block')
    expect(decide('observe', 'write', medium, site(true))).toBe('block')
  })

  it('copilot mode asks approval for every write, allowed site or not', () => {
    expect(decide('copilot', 'write', safe, site(true))).toBe('require-approval')
    expect(decide('copilot', 'write', high, site(true))).toBe('require-approval')
    expect(decide('copilot', 'write', safe, site(false))).toBe('require-approval')
    expect(decide('copilot', 'read', safe, site(false))).toBe('allow')
  })

  it('auto mode acts alone on an allowed site and asks on one that is not', () => {
    expect(decide('auto', 'write', medium, site(true))).toBe('allow')
    expect(decide('auto', 'write', medium, site(false))).toBe('require-approval')
  })

  it('auto mode still asks on a high-risk write even on an allowed site', () => {
    expect(decide('auto', 'write', high, site(true))).toBe('require-approval')
  })

  it('the site list never changes reads or control tools', () => {
    expect(decide('auto', 'read', safe, site(false))).toBe('allow')
    expect(decide('auto', 'control', safe, site(false))).toBe('allow')
  })

  it('hard blocks always require approval, in every mode and every site', () => {
    for (const mode of ['observe', 'copilot', 'auto'] as const) {
      expect(decide(mode, 'write', blocked, site(true))).toBe('require-approval')
      expect(decide(mode, 'write', blocked, site(false))).toBe('require-approval')
    }
  })

  it('a hard-blocked page never stops a read, in any mode', () => {
    for (const mode of ['observe', 'copilot', 'auto'] as const) {
      expect(decide(mode, 'read', blocked, site(false))).toBe('allow')
      expect(decide(mode, 'control', blocked, site(false))).toBe('allow')
    }
  })
})

describe('autoSiteReason', () => {
  it('says nothing when the site had no part in the decision', () => {
    expect(autoSiteReason('auto', site(true))).toBeNull()
    expect(autoSiteReason('copilot', site(false))).toBeNull()
    expect(autoSiteReason('observe', site(false))).toBeNull()
  })

  it('names the site the user has to allow', () => {
    expect(autoSiteReason('auto', site(false))).toBe('Auto mode asks first on shop.test, which you have not allowed.')
  })

  it('explains a page with no host instead of blaming an empty one', () => {
    expect(autoSiteReason('auto', { host: '', allowlisted: false })).toContain('not a plain web page')
  })
})
