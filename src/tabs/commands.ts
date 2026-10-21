import { clip } from '@/research/text'
import { hostOf } from './model'
import type { TabInfo, TabIntent, TabMatch } from './types'

/**
 * Natural-language tab commands (spec §8: "close all YouTube tabs", "group my
 * work tabs", "find the tab with the pricing page", "save this session for
 * tomorrow").
 *
 * Parsing is deterministic and cheap: verb first, then the object. When the
 * sentence is too loose for the rules, `TabManager` asks the small model to
 * classify it and validates the answer against the same intent shape — the
 * model never invents a new verb, it only fills one in.
 */

const ALIASES: Record<string, string> = {
  youtube: 'youtube.com',
  yt: 'youtube.com',
  gmail: 'mail.google.com',
  gdocs: 'docs.google.com',
  docs: 'docs.google.com',
  drive: 'drive.google.com',
  calendar: 'calendar.google.com',
  github: 'github.com',
  gitlab: 'gitlab.com',
  stackoverflow: 'stackoverflow.com',
  stackoverflowdiscussion: 'stackoverflow.com',
  reddit: 'reddit.com',
  hn: 'news.ycombinator.com',
  twitter: 'twitter.com',
  x: 'x.com',
  linkedin: 'linkedin.com',
  netflix: 'netflix.com',
  spotify: 'spotify.com',
  amazon: 'amazon.com',
  notion: 'notion.so',
  figma: 'figma.com',
  zoom: 'zoom.us',
  wikipedia: 'wikipedia.org',
  twitch: 'twitch.tv',
  medium: 'medium.com',
}

const FILLER = new Set([
  'a', 'all', 'an', 'and', 'any', 'about', 'are', 'back', 'bring', 'can', 'close', 'could',
  'containing', 'couple', 'do', 'does', 'did', 'everything', 'few', 'find', 'for', 'get', 'go',
  'group', 'has', 'have', 'how', 'i', 'is', 'it', 'jump', 'list', 'locate', 'many', 'me', 'much',
  'my', 'need', 'of', 'on', 'open', 'page', 'pages', 'please', 'rest', 'search', 'show', 'some',
  'still', 'switch', 'tab', 'tabs', 'that', 'the', 'their', 'them', 'there', 'these', 'this',
  'those', 'to', 'towards', 'up', 'w', 'what', 'where', 'which', 'with', 'want', 'you', 'your',
])

function lower(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** A bare domain in the sentence, e.g. "close reddit.com tabs". */
function explicitHost(text: string): string | null {
  const match = /\b([a-z0-9-]+(?:\.[a-z0-9-]+){1,3})\b/.exec(text)
  if (match === null) return null
  const candidate = match[1]!
  if (/\.(com|org|net|io|dev|co|ai|edu|gov|us|uk|de|fr|jp|in|au|ca|nl|se|no|es|it|pl|ru|br|xyz|app|me|tv|gg)$/i.test(candidate)) {
    return candidate
  }
  return null
}

/**
 * Which set of tabs the sentence talks about. Falls back to a content query so
 * "close tabs about sourdough" still means something.
 */
export function matchFromText(text: string, tabs: readonly TabInfo[]): TabMatch {
  const clean = lower(text)

  if (/\b(other|rest|remaining|everything else)\b/.test(clean)) return { scope: 'others' }

  const host = explicitHost(clean)
  if (host !== null) return { scope: 'host', host }

  const words = clean.split(/[^a-z0-9.]+/).filter((word) => word.length > 1)
  for (const word of words) {
    const alias = ALIASES[word]
    if (alias !== undefined) return { scope: 'host', host: alias }
  }
  // A word that matches a host the user already has open ("close the arxiv tabs").
  for (const word of words) {
    const hit = tabs.find((tab) => {
      const host = hostOf(tab.url)
      return host !== '' && (host === word || host.startsWith(`${word}.`) || host.split('.')[0] === word)
    })
    if (hit !== undefined) return { scope: 'host', host: hostOf(hit.url) }
  }

  const residual = queryFromText(clean)
  if (residual !== '') return { scope: 'query', query: residual }
  return { scope: 'all' }
}

/** Everything that is not a verb or filler. */
export function queryFromText(text: string): string {
  const words = lower(text)
    .replace(/[",.?!;:]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !FILLER.has(word) && !/^\d+$/.test(word))
  return clip(words.join(' '), 60)
}

function sessionNameFrom(text: string): string {
  const quoted = /["“”']([^"“”']+)["“”']/.exec(text)
  if (quoted !== null) return clip(quoted[1]!, 60)
  const named = /\b(?:as|called|named)\s+(.+)$/.exec(text)
  if (named !== null) return clip(named[1]!.replace(/\bsession\b/g, ''), 60)
  const when = /\bfor\s+(tomorrow|today|the\s+weekend|next\s+week|later|friday|monday|sunday)\b/.exec(text)
  if (when !== null) return clip(when[1]!.replace(/\s+/g, ' '), 60)
  return ''
}

function daysFrom(text: string): number | undefined {
  const match = /(\d+)\s*(day|days|d)\b/.exec(text)
  if (match === null) return undefined
  return Number.parseInt(match[1] ?? '0', 10)
}

/**
 * Deterministic intent parse. Returns null when the sentence is too vague, in
 * which case the manager may ask the model.
 */
export function parseCommand(text: string, tabs: readonly TabInfo[] = []): TabIntent | null {
  const clean = lower(text)
  // The name is the one thing we keep in the user's own casing.
  const original = text.trim().replace(/\s+/g, ' ')
  if (clean === '') return null

  const mentionsSession = /\b(session|window)\b/.test(clean)

  if (/\b(undo|revert|bring back|reopen)\b/.test(clean) && !mentionsSession) return { kind: 'undo' }

  if (mentionsSession && /\b(restore|resume|reopen|open|load|bring back)\b/.test(clean)) {
    const named = sessionNameFrom(original)
    const loose = queryFromText(clean.replace(/\b(sessions?|windows?|restore|resume|reopen|open|load|bring|back|from|yesterday)\b/g, ' '))
    return { kind: 'restore', name: named === '' ? loose : named }
  }

  if (/\b(list|show|which|all)\b/.test(clean) && /\bsessions?\b/.test(clean) && !/\brestore\b/.test(clean)) {
    return { kind: 'sessions' }
  }

  if (/\b(merge|dedupe|de-dupe|de duplicate|duplicat\w*|dupe)\b/.test(clean)) {
    return { kind: 'merge', match: matchFromText(clean.replace(/duplicat\w*|merge|dedupe|tabs?/g, ''), tabs) }
  }

  if (/\b(free|clear|clean|reduce|save)\b/.test(clean) && /\b(memory|ram|resources?|discard|suspend)\b/.test(clean)) {
    const count = /(\d+)/.exec(clean)
    return { kind: 'free', match: { scope: 'all' }, ...(count === null ? {} : { maxTabs: Number.parseInt(count[1]!, 10) }) }
  }

  if (/\b(stale|unused|idle|dusty|old|untouched|abandoned)\b/.test(clean)) {
    const days = daysFrom(clean)
    return { kind: 'stale', days: days === undefined || days <= 0 ? 7 : days }
  }

  if (/\bindex\b/.test(clean) || (/\bread\b/.test(clean) && /\b(everything|all|page|pages|content|text)\b/.test(clean))) {
    return { kind: 'index' }
  }

  if (/\bungroup\b|\bseparate\b|\bsplit\b/.test(clean)) {
    return { kind: 'ungroup', match: matchFromText(clean.replace(/\b(ungroup|separate|split|up)\b/g, ''), tabs) }
  }

  if (/\b(group|cluster|organise|organize|tidy)\b/.test(clean)) {
    return { kind: 'group', match: matchFromText(clean.replace(/\b(group|cluster|organise|organize|tidy|up)\b/g, ''), tabs) }
  }

  if (/\b(save|keep|park|freeze|snapshot)\b/.test(clean) && (mentionsSession || /\btomorrow|later|weekend\b/.test(clean))) {
    const name = sessionNameFrom(original)
    return { kind: 'save', name, note: '', tags: [] }
  }

  if (/\b(close|kill|cull|get rid)\b/.test(clean)) {
    return { kind: 'close', match: matchFromText(clean.replace(/\b(close|kill|cull|all|every|the|my)\b/g, ' '), tabs) }
  }

  if (/\b(switch|go to|jump|focus|activate)\b/.test(clean)) {
    return { kind: 'switch', query: queryFromText(clean) }
  }

  if (/\b(find|which|where|search|locate)\b/.test(clean)) {
    return { kind: 'find', query: queryFromText(clean) }
  }

  if (/\b(list|how many|what|show)\b/.test(clean) && /\b(tab|tabs|open)\b/.test(clean)) {
    return { kind: 'list', match: matchFromText(clean, tabs) }
  }

  return null
}

/** One-line, human description of an intent — used as the report title. */
export function describeIntent(intent: TabIntent): string {
  switch (intent.kind) {
    case 'list':
      return 'List tabs'
    case 'close':
      return `Close ${matchLabel(intent.match)}`
    case 'group':
      return `Group ${matchLabel(intent.match)}`
    case 'ungroup':
      return `Ungroup ${matchLabel(intent.match)}`
    case 'merge':
      return 'Merge duplicate tabs'
    case 'find':
      return `Search tabs for "${intent.query}"`
    case 'switch':
      return `Switch to "${intent.query}"`
    case 'free':
      return 'Suspend heavy tabs'
    case 'stale':
      return `Tabs untouched for ${intent.days}+ days`
    case 'index':
      return 'Index page text'
    case 'save':
      return intent.name === '' ? 'Save session' : `Save session "${intent.name}"`
    case 'restore':
      return `Restore session "${intent.name}"`
    case 'sessions':
      return 'Saved sessions'
    case 'undo':
      return 'Undo'
  }
}

export function matchLabel(match: TabMatch): string {
  switch (match.scope) {
    case 'all':
      return 'all tabs'
    case 'others':
      return 'the other tabs'
    case 'host':
      return `${match.host} tabs`
    case 'query':
      return `tabs about "${match.query}"`
    case 'ids':
      return `${match.ids.length} selected tab${match.ids.length === 1 ? '' : 's'}`
  }
}

/** Hosts a command named, so the UI can show what was understood. */
export function hostAlias(word: string): string | undefined {
  return ALIASES[lower(word)]
}
