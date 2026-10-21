import type { ElementRole, ElementSelector } from './pageState'

/**
 * One browser action the agent wants to perform on a tab (spec §4/§5).
 * Elements are addressed by the index shown in the page-state spec lines,
 * so the LLM never needs selectors.
 */
/**
 * A file handed to an `<input type=file>`. Navigator stores profile documents
 * as text, so an upload is always built from that text — a real PDF has to be
 * picked by the person sitting in front of the browser.
 */
export interface UploadedFile {
  name: string
  mime: string
  text: string
}

export type ActRequest =
  | { type: 'click'; index: number }
  | { type: 'type'; index: number; text: string; submit?: boolean }
  | { type: 'scroll'; direction: 'down' | 'up'; amount?: number; index?: number }
  | { type: 'hover'; index: number }
  | { type: 'press_key'; key: string; index?: number }
  | { type: 'select'; index: number; value: string }
  | { type: 'check'; index: number; checked: boolean }
  | { type: 'upload'; index: number; file: UploadedFile }
  | { type: 'drag'; fromIndex: number; toIndex: number }

/**
 * What an action actually touched, kept so a recipe can find the same control
 * on a later visit (spec §11). The selector never reaches the model — it goes
 * straight from the content script into the audit log.
 */
export interface ActTarget {
  selector: ElementSelector
  label: string
  role: ElementRole
  /** `type` attribute of an input — what a password or OTP field is spotted from. */
  inputType: string | null
}

export type ActOutcome = {
  ok: true
  /** Human-readable summary of what happened, for the transcript. */
  detail: string
  /** True when the DOM event path could not finish the job — background should retry via CDP. */
  fellBack?: boolean
  target?: ActTarget
}

export type ActFailure = {
  ok: false
  error: string
}

export type ActResult = ActOutcome | ActFailure
