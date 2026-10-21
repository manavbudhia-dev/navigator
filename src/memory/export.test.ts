import { describe, expect, it } from 'vitest'

import { auditExportJson } from './export'
import type { AuditRow } from './db'

function row(overrides: Partial<AuditRow> & Pick<AuditRow, 'at' | 'goal' | 'tool'>): AuditRow {
  return {
    args: { index: 3 },
    risk: 'low',
    hardBlock: null,
    decision: 'allow',
    ok: true,
    detail: 'clicked',
    ...overrides,
  }
}

function parse(json: string): { exportedAt: number; app: string; rows: number; log: AuditRow[] } {
  return JSON.parse(json) as ReturnType<typeof parse>
}

describe('auditExportJson', () => {
  it('wraps the log in a header so an export explains itself', () => {
    const parsed = parse(auditExportJson([row({ at: 5, goal: 'buy tickets', tool: 'click' })], 999))
    expect(parsed).toMatchObject({ exportedAt: 999, app: 'navigator', rows: 1 })
    expect(parsed.log).toEqual([expect.objectContaining({ at: 5, tool: 'click' })])
  })

  it('carries the evidence fields, not just the tool name', () => {
    const parsed = parse(
      auditExportJson(
        [
          row({
            at: 5,
            goal: 'buy tickets',
            tool: 'click',
            runId: 'r1',
            url: 'https://shop.test/checkout',
            ms: 240,
            promptTokens: 1200,
            completionTokens: 60,
            thumb: 'data:image/jpeg;base64,AAA',
          }),
        ],
        1,
      ),
    )
    expect(parsed.log[0]).toMatchObject({
      runId: 'r1',
      url: 'https://shop.test/checkout',
      ms: 240,
      promptTokens: 1200,
      thumb: 'data:image/jpeg;base64,AAA',
    })
  })

  it('exports an empty log without lying about the count', () => {
    expect(parse(auditExportJson([], 7))).toMatchObject({ rows: 0, log: [] })
  })
})
