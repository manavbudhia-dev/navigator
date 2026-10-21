import type { ElementRole } from '@/types/pageState'

/**
 * The page-state spec lines (`[8]<input type="email" …>…`) are the only
 * element information that leaves the content script. The agent loop parses
 * them back out to feed the risk scorer without shipping full selectors
 * over the wire (spec §3a).
 */

export interface ElementLineInfo {
  index: number
  tag: string
  role: ElementRole
  inputType: string | null
  text: string
  attributes: Record<string, string>
}

const LINE = /^\[(\d+)\]<([a-z0-9-]+)((?:\s+[^=>]+="[^"]*")*)\s*>/

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of raw.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    attrs[match[1]!] = match[2]!
  }
  return attrs
}

function roleOf(tag: string, attrs: Record<string, string>): { role: ElementRole; inputType: string | null } {
  const inputType = attrs['type'] ?? null
  if (tag === 'a' && attrs['href']) return { role: 'link', inputType }
  if (tag === 'button') return { role: 'button', inputType }
  if (tag === 'select') return { role: 'combobox', inputType }
  if (tag === 'textarea') return { role: 'textbox', inputType }
  if (tag === 'input') {
    if (inputType === 'checkbox') return { role: 'checkbox', inputType }
    if (inputType === 'radio') return { role: 'radio', inputType }
    if (inputType === 'file') return { role: 'file', inputType }
    return { role: 'textbox', inputType }
  }
  return { role: 'clickable', inputType }
}

export function parseElementLine(line: string): ElementLineInfo | null {
  const match = LINE.exec(line)
  if (!match) return null
  const [, index, tag, attrRaw = ''] = match
  const attributes = parseAttributes(attrRaw)
  const { role, inputType } = roleOf(tag!, attributes)
  // Text sits between the closing `>` of the open tag and the next `<`.
  const afterOpen = line.slice(match[0]!.length)
  const text = afterOpen.split('<')[0] ?? ''
  return { index: Number(index), tag: tag!, role, inputType, text, attributes }
}

/** The remembered line for one index, or null when the model pointed at nothing. */
export function findElementInfo(lines: string[], index: number): ElementLineInfo | null {
  for (const line of lines) {
    const info = parseElementLine(line)
    if (info && info.index === index) return info
  }
  return null
}
