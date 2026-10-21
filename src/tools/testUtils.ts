import type { ActResult } from '@/types/actions'
import type { CaptureResult, SaveFileRequest, SaveFileResult, ToolHost } from './types'

/** The host members that only Chrome can answer. */
export type ChromeHostStub = Pick<
  ToolHost,
  'goBack' | 'goForward' | 'reload' | 'waitFor' | 'waitForLoad' | 'capture' | 'saveFile'
>

/**
 * Vitest-only. Tests that drive the agent loop or the tool registry care about
 * page reads and acts, not about Chrome history, pictures or the Downloads
 * folder — so they spread these no-ops into their fake host and record only
 * what they assert on.
 */
export function stubChromeHost(
  calls: string[] = [],
  overrides: Partial<ChromeHostStub> = {},
): ChromeHostStub {
  const capture: CaptureResult = { dataUrl: 'data:image/jpeg;base64,AAAA', width: 1280, height: 720 }
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
    async capture() {
      calls.push('screenshot')
      return capture
    },
    async saveFile(request: SaveFileRequest): Promise<SaveFileResult> {
      calls.push(request.kind === 'text' ? `write_file ${request.fileName}` : `download_file ${request.fileName ?? ''}`)
      return { ok: true, savedAs: request.fileName ?? 'from the page' }
    },
    ...overrides,
  }
}
