/**
 * File output for the data tools (spec §4). Chrome's downloads API can only
 * write inside the user's Downloads folder, so everything lands in a
 * `Navigator/` subfolder and nothing here may escape it.
 */

/** Where Navigator puts what it writes. */
export const OUTPUT_FOLDER = 'Navigator'

/** Content the agent composes itself. */
export const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ics'])

/** Files a page can hand over. Deliberately no executable, script or SVG. */
export const DOWNLOAD_EXTENSIONS = new Set([
  'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'xml', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'epub', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp3', 'm4a', 'wav', 'ogg', 'mp4', 'webm', 'zip',
])

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  ics: 'text/calendar',
}

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function mimeFor(fileName: string): string {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? 'application/octet-stream'
}

/**
 * A name that cannot escape the output folder and cannot be a hidden or
 * path-shaped surprise: no directories, no leading dots, no reserved
 * characters, no empty result.
 */
export function safeFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim()
  const withoutLeadingDots = base.replace(/^\.+/, '')
  const cleaned = withoutLeadingDots.slice(0, 80).replace(/[. ]+$/, '')
  return cleaned === '' ? 'untitled' : cleaned
}

export type FileGuard = { ok: true; path: string; name: string } | { ok: false; error: string }

/** Name it, check its extension, put it in the folder. */
export function guardFile(raw: string, allowed: ReadonlySet<string>, what: string): FileGuard {
  const name = safeFileName(raw)
  const extension = extensionOf(name)
  if (extension === '') {
    return { ok: false, error: `${name} has no file extension. Use one of: ${[...allowed].join(', ')}.` }
  }
  if (!allowed.has(extension)) {
    return { ok: false, error: `Navigator will not write a .${extension} ${what}. Allowed: ${[...allowed].join(', ')}.` }
  }
  return { ok: true, path: `${OUTPUT_FOLDER}/${name}`, name }
}

/** Only http(s) may be fetched, and never a chrome or extension page. */
export function guardRemoteUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: `"${raw.slice(0, 80)}" is not a full URL. Pass the address including https://.` }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `Navigator only downloads over http(s), not ${url.protocol}.` }
  }
  return { ok: true, url: url.href }
}
