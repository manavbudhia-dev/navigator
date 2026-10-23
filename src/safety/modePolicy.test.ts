import { describe, expect, it } from 'vitest'

import { autoSiteReason, decide, siteBlockReason } from './modePolicy'

import type { SiteContext } from './siteRules'
import type { RiskAssessment } from './risk'

const safe: RiskAssessment = { level: 'safe', reasons: [], hardBlock: null }
const medium: RiskAssessment = { level: 'medium', reasons: [], hardBlock: null }
const high: RiskAssessment = { level: 'high', reasons: [], hardBlock: null }
const hard: RiskAssessment = { level: 'medium', reasons: [], hardBlock: 'payment' }

function site(allowlisted: boolean, blocked = false): SiteContext {
  return { host: 'shop.test', allowlisted, blocked }
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

  it('the allow list never changes reads or control tools', () => {
    expect(decide('auto', 'read', safe, site(false))).toBe('allow')
    expect(decide('auto', 'control', safe, site(false))).toBe('allow')
  })

  it('hard blocks always require approval, in every mode and every site', () => {
    for (const mode of ['observe', 'copilot', 'auto'] as const) {
      expect(decide(mode, 'write', hard, site(true))).toBe('require-approval')
      expect(decide(mode, 'write', hard, site(false))).toBe('require-approval')
    }
  })

  it('a hard-blocked page never stops a read, in any mode', () => {
    for (const mode of ['observe', 'copilot', 'auto'] as const) {
      expect(decide(mode, 'read', hard, site(false))).toBe('allow')
      expect(decide(mode, 'control', hard, site(false))).toBe('allow')
    }
  })

  it('a blocked site stops reads and writes in every mode', () => {
    for (const mode of ['observe', 'copilot', 'auto'] as const) {
      expect(decide(mode, 'read', safe, site(false, true))).toBe('block')
      expect(decide(mode, 'write', safe, site(false, true))).toBe('block')
      expect(decide(mode, 'write', high, site(true, true))).toBe('block')
    }
  })

  it('a blocked site outranks an approval, so no card can widen it', () => {
    for (const mode of ['observe', 'copilot', 'auto'] as const) {
      expect(decide(mode, 'write', hard, site(true, true))).toBe('block')
    }
  })

  it('a blocked site still lets the agent ask the user and finish', () => {
    for (const mode of ['observe', 'copilot', 'auto'] as const) {
      expect(decide(mode, 'control', safe, site(false, true))).toBe('allow')
      expect(decide(mode, 'control', hard, site(false, true))).toBe('allow')
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
    expect(autoSiteReason('auto', { host: '', allowlisted: false, blocked: false })).toContain('not a plain web page')
  })

  it('stands aside when the block list already answers for it', () => {
    expect(autoSiteReason('auto', site(false, true))).toBeNull()
  })
})

describe('siteBlockReason', () => {
  it('says nothing about a site that is not blocked', () => {
    expect(siteBlockReason(site(false))).toBeNull()
    expect(siteBlockReason(site(true))).toBeNull()
  })

  it('names the site the user closed', () => {
    expect(siteBlockReason(site(false, true))).toBe(
      'shop.test is on your blocked list, so Navigator does not read or act on it.',
    )
  })

  it('explains a page with no host instead of blaming an empty one', () => {
    expect(siteBlockReason({ host: '', allowlisted: false, blocked: true })).toContain('a site you blocked')
  })
})
