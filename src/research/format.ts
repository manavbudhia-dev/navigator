import type { ResearchResult, SourceNote } from './types'

/**
 * Output formats (spec §7): Markdown report, comparison table, CSV, JSON
 * shaped by a user schema, bullet brief. All pure so the panel, the download
 * button and the clipboard share one implementation.
 */

export type ResearchFormat = 'markdown' | 'table' | 'csv' | 'json' | 'brief'

export const FORMATS: { id: ResearchFormat; label: string; ext: string; mime: string }[] = [
  { id: 'markdown', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
  { id: 'table', label: 'Table', ext: 'md', mime: 'text/markdown' },
  { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json' },
  { id: 'brief', label: 'Brief', ext: 'txt', mime: 'text/plain' },
]

export function formatMeta(format: ResearchFormat): (typeof FORMATS)[number] {
  const meta = FORMATS.find((entry) => entry.id === format)
  if (meta === undefined) throw new Error(`Unknown format: ${format}`)
  return meta
}

const FIELDS: Record<string, (result: ResearchResult) => unknown> = {
  question: (result) => result.question,
  depth: (result) => result.depth,
  date: (result) => new Date(result.createdAt).toISOString(),
  answer: (result) => result.answer,
  brief: (result) => result.brief,
  sources: (result) => result.sources.map(sourceRow),
  citations: (result) => result.citations,
  contradictions: (result) => result.contradictions,
  gaps: (result) => result.gaps,
  discarded: (result) => result.discarded,
  tokens: (result) => ({ prompt: result.promptTokens, completion: result.completionTokens }),
}

/** Keys the user may ask for in a JSON schema. */
export const JSON_FIELDS = Object.keys(FIELDS)

function sourceRow(note: SourceNote): Record<string, unknown> {
  return {
    url: note.url,
    title: note.title,
    author: note.author,
    publish_date: note.publishDate,
    relevance: note.relevance,
    credibility: note.credibility,
    snippet_quotes: note.snippetQuotes,
    claims: note.claims,
  }
}

/**
 * `{"summary":"answer","refs":"sources"}` → `{"summary":…,"refs":…}`.
 * Unknown target fields are dropped rather than guessed.
 */
export function toJson(result: ResearchResult, schema?: string): string {
  const trimmed = schema?.trim() ?? ''
  if (trimmed === '') return JSON.stringify(defaultJson(result), null, 2)

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return JSON.stringify(defaultJson(result), null, 2)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return JSON.stringify(defaultJson(result), null, 2)
  }

  const out: Record<string, unknown> = {}
  for (const [key, target] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof target !== 'string') continue
    const pick = FIELDS[target]
    if (pick) out[key] = pick(result)
  }
  return JSON.stringify(out, null, 2)
}

function defaultJson(result: ResearchResult): Record<string, unknown> {
  return {
    question: result.question,
    depth: result.depth,
    date: new Date(result.createdAt).toISOString(),
    answer: result.answer,
    brief: result.brief,
    sources: result.sources.map(sourceRow),
    contradictions: result.contradictions,
    gaps: result.gaps,
    citations: result.citations,
    tokens: { prompt: result.promptTokens, completion: result.completionTokens },
  }
}

export function toCsv(result: ResearchResult): string {
  const header = ['url', 'title', 'author', 'publish_date', 'relevance', 'credibility', 'claim']
  const rows: string[] = [header.join(',')]
  for (const note of result.sources) {
    const claims = note.claims.length > 0 ? note.claims : ['']
    for (const claim of claims) {
      rows.push(
        [note.url, note.title, note.author ?? '', note.publishDate ?? '', note.relevance, note.credibility, claim]
          .map(csvCell)
          .join(','),
      )
    }
  }
  return rows.join('\n')
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /["\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Comparison table: one row per source, so differences stay visible. */
export function toTable(result: ResearchResult): string {
  if (result.sources.length === 0) return '_No sources were kept._'
  const head = '| # | Source | Credibility | Relevance | Date | Author | Main claim |'
  const rule = '| --- | --- | --- | --- | --- | --- | --- |'
  const rows = result.sources.map((note, i) => {
    const citation = result.citations.find((entry) => entry.sourceId === note.id)
    const claim = note.claims[0] ?? note.summary ?? '—'
    return `| ${citation?.n ?? i + 1} | ${escapeCell(note.title)} | ${note.credibility.toFixed(2)} | ${note.relevance.toFixed(2)} | ${note.publishDate ?? '—'} | ${note.author ?? '—'} | ${escapeCell(clipCell(claim))} |`
  })
  return [head, rule, ...rows].join('\n')
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ')
}

function clipCell(text: string): string {
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

export function toBrief(result: ResearchResult): string {
  const lines = result.brief.map((line) => `- ${line}`)
  if (result.contradictions.length > 0) {
    lines.push('', 'Contested:')
    for (const conflict of result.contradictions) {
      lines.push(`- ${conflict.topic} (${conflict.sides.length} sources disagree)`)
    }
  }
  if (result.gaps.length > 0) {
    lines.push('', 'Still open:')
    for (const gap of result.gaps) lines.push(`- ${gap}`)
  }
  return lines.join('\n')
}

export function toMarkdown(result: ResearchResult): string {
  const parts: string[] = []
  parts.push(`# ${result.question}`)
  parts.push('')
  parts.push(`_${result.depth} research · ${result.sources.length} sources · ${result.rounds} gather round${result.rounds === 1 ? '' : 's'}_`)
  parts.push('')
  parts.push(result.answer)

  if (result.contradictions.length > 0) {
    parts.push('', '## Where the sources disagree')
    for (const conflict of result.contradictions) {
      parts.push('', `**${conflict.topic}**`)
      for (const side of conflict.sides) {
        const citation = result.citations.find((entry) => entry.sourceId === side.sourceId)
        parts.push(`- ${side.claim}${citation === undefined ? '' : ` [${citation.n}]`}`)
      }
    }
  }

  parts.push('', '## Sources')
  for (const citation of result.citations) {
    const note = result.sources.find((source) => source.id === citation.sourceId)
    const meta = [
      note?.author !== undefined && note.author !== null ? `by ${note.author}` : null,
      note?.publishDate ?? null,
      note !== undefined ? `credibility ${note.credibility.toFixed(2)}` : null,
    ].filter((value): value is string => value !== null)
    parts.push(`${citation.n}. [${citation.title}](${citation.url})${meta.length > 0 ? ` — ${meta.join(' · ')}` : ''}`)
  }

  if (result.discarded.length > 0) {
    parts.push('', `_${result.discarded.length} page${result.discarded.length === 1 ? ' was' : 's were'} opened and dropped as off-topic._`)
  }
  if (result.gaps.length > 0) {
    parts.push('', '## Still open')
    for (const gap of result.gaps) parts.push(`- ${gap}`)
  }
  return parts.join('\n')
}

export function render(result: ResearchResult, format: ResearchFormat, schema?: string): string {
  switch (format) {
    case 'markdown':
      return toMarkdown(result)
    case 'table':
      return toTable(result)
    case 'csv':
      return toCsv(result)
    case 'json':
      return toJson(result, schema)
    case 'brief':
      return toBrief(result)
  }
}

/** filesystem-safe-ish slug for the download button */
export function downloadName(question: string, format: ResearchFormat): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const base = slug === '' ? 'research' : slug
  return `${base}.${formatMeta(format).ext}`
}
