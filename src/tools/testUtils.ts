import type { ActResult } from '@/types/actions'
import type { ToolHost } from './types'

/**
 * Vitest-only. Tests that drive the agent loop or the tool registry care about
 * page reads and acts, not about Chrome history — so they spread these no-ops
 * into their fake host and record only what they assert on.
 */
export function stubNavigation(
  calls: string[] = [],
  overrides: Partial<Pick<ToolHost, 'goBack' | 'goForward' | 'reload' | 'waitFor' | 'waitForLoad'>> = {},
): Pick<ToolHost, 'goBack' | 'goForward' | 'reload' | 'waitFor' | 'waitForLoad'> {
  return {
    async goBack() {
      calls.push('go_back')
    },
    async goForward() {
      calls.push('go_forward')
    },
    async reload() {
      calls.push('reload')
    },
    async waitFor(): Promise<ActResult> {
      return { ok: true, detail: 'Condition met.' }
    },
    async waitForLoad() {
      calls.push('wait_for load')
      return true
    },
    ...overrides,
  }
}
