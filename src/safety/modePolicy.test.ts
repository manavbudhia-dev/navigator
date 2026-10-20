import { describe, expect, it } from 'vitest'

import { decide } from './modePolicy'
import type { RiskAssessment } from './risk'

const safe: RiskAssessment = { level: 'safe', reasons: [], hardBlock: null }
const medium: RiskAssessment = { level: 'medium', reasons: [], hardBlock: null }
const high: RiskAssessment = { level: 'high', reasons: [], hardBlock: null }
const blocked: RiskAssessment = { level: 'medium', reasons: [], hardBlock: 'payment' }

describe('decide', () => {
  it('observe mode allows reads but blocks every write', () => {
    expect(decide('observe', 'read', safe)).toBe('allow')
    expect(decide('observe', 'write', safe)).toBe('block')
    expect(decide('observe', 'write', medium)).toBe('block')
  })

  it('copilot mode asks approval for every write', () => {
    expect(decide('copilot', 'write', safe)).toBe('require-approval')
    expect(decide('copilot', 'write', high)).toBe('require-approval')
    expect(decide('copilot', 'read', safe)).toBe('allow')
  })

  it('auto mode runs low/medium writes autonomously, asks on high', () => {
    expect(decide('auto', 'write', medium)).toBe('allow')
    expect(decide('auto', 'write', high)).toBe('require-approval')
  })

  it('hard blocks always require approval, in every mode', () => {
    for (const mode of ['observe', 'copilot', 'auto'] as const) {
      expect(decide(mode, 'write', blocked)).toBe('require-approval')
    }
  })

  it('control tools (ask_user, finish) are never blocked', () => {
    expect(decide('observe', 'control', safe)).toBe('allow')
  })
})
