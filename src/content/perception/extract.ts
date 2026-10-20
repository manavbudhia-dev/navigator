/**
 * Readability-style main-content extraction to Markdown (spec §3b).
 * Lightweight by design: prefer semantic containers, score the rest by
 * paragraph text vs link text, then walk once emitting Markdown.
 */

const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'video',
  'audio',
  'iframe',
  'nav',
  'footer',
  'aside',
  'form',
  'button',
  'input',
  'select',
  'textarea',
])

const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'li', 'blockquote', 'pre', 'td', 'th', 'figure'])

function isSkippable(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true
  if (el.getAttribute('aria-hidden') === 'true') return true
  if (el.hasAttribute('hidden')) return true
  return false
}

function textLength(el: Element): number {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length
}

function linkTextLength(el: Element): number {
  let total = 0
  for (const a of Array.from(el.querySelectorAll('a'))) {
    total += textLength(a)
  }
  return total
}

/** Container selection: main/article win outright; otherwise score candidates. */
export function pickMainContainer(doc: Document): Element {
  const semantic = doc.querySelector('main') ?? doc.querySelector('article')
  if (semantic !== null && textLength(semantic) > 200) return semantic

  let best: Element = doc.body
  let bestScore = 0
  for (const candidate of Array.from(doc.querySelectorAll('div, section, article'))) {
    if (isSkippable(candidate)) continue
    const text = textLength(candidate)
    if (text < 250) continue
    const links = linkTextLength(candidate)
    const paragraphs = candidate.querySelectorAll('p, li, td').length
    const score = text * (1 - links / Math.max(text, 1)) + paragraphs * 20
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

function inlineMarkdown(el: Element, doc: Document): string {
  let out = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      out += (node.textContent ?? '').replace(/\s+/g, ' ')
      continue
    }
    if (node.nodeType !== 1) continue
    const child = node as Element
    if (isSkippable(child)) continue
    const tag = child.tagName.toLowerCase()
    if (tag === 'a' && child.hasAttribute('href')) {
      const label = inlineMarkdown(child, doc).trim()
      const href = child.getAttribute('href') ?? ''
      if (label !== '' && !href.startsWith('javascript:')) {
        out += `[${label}](${href})`
      } else {
        out += label
      }
      continue
    }
    if (tag === 'br') {
      out += '\n'
      continue
    }
    if (tag === 'strong' || tag === 'b') {
      out += `**${inlineMarkdown(child, doc).trim()}**`
      continue
    }
    if (tag === 'em' || tag === 'i') {
      out += `*${inlineMarkdown(child, doc).trim()}*`
      continue
    }
    if (tag === 'code') {
      out += `\`${inlineMarkdown(child, doc).trim()}\``
      continue
    }
    out += inlineMarkdown(child, doc)
  }
  return out
}

function walkMarkdown(el: Element, doc: Document, out: string[]): void {
  for (const child of Array.from(el.children)) {
    if (isSkippable(child)) continue
    const tag = child.tagName.toLowerCase()

    const headingMatch = /^h([1-6])$/.exec(tag)
    if (headingMatch) {
      const level = Number(headingMatch[1])
      const text = inlineMarkdown(child, doc).trim()
      if (text !== '') out.push(`${'#'.repeat(level)} ${text}`)
      continue
    }

    if (tag === 'ul' || tag === 'ol') {
      let i = 1
      for (const li of Array.from(child.children)) {
        if (li.tagName.toLowerCase() !== 'li') continue
        const prefix = tag === 'ol' ? `${i}. ` : '- '
        const text = inlineMarkdown(li, doc).trim()
        if (text !== '') out.push(`${prefix}${text}`)
        i += 1
      }
      continue
    }

    if (tag === 'table') {
      for (const row of Array.from(child.querySelectorAll('tr'))) {
        const cells = Array.from(row.querySelectorAll('th, td'))
          .map((cell) => inlineMarkdown(cell, doc).trim().replace(/\|/g, '\\|'))
          .join(' | ')
        if (cells !== '') out.push(`| ${cells} |`)
      }
      continue
    }

    if (tag === 'pre') {
      const code = (child.textContent ?? '').trim()
      if (code !== '') out.push('```\n' + code + '\n```')
      continue
    }

    if (tag === 'blockquote') {
      const text = inlineMarkdown(child, doc).trim()
      if (text !== '') out.push(`> ${text}`)
      continue
    }

    if (BLOCK_TAGS.has(tag)) {
      const hasBlockChildren = Array.from(child.children).some((grand) =>
        BLOCK_TAGS.has(grand.tagName.toLowerCase()) || /^h[1-6]$/.test(grand.tagName.toLowerCase()),
      )
      if (hasBlockChildren) {
        walkMarkdown(child, doc, out)
        continue
      }
      const text = inlineMarkdown(child, doc).trim()
      if (text !== '') out.push(text)
      continue
    }

    walkMarkdown(child, doc, out)
  }
}

/** Main content as Markdown, deduplicated and whitespace-collapsed. */
export function extractMarkdown(doc: Document): string {
  if (!doc.body) return ''
  const container = pickMainContainer(doc)
  const lines: string[] = []
  walkMarkdown(container, doc, lines)

  const deduped: string[] = []
  for (const line of lines) {
    const collapsed = line.replace(/[ \t]+/g, ' ').trim()
    if (collapsed === '') continue
    if (deduped[deduped.length - 1] === collapsed) continue
    deduped.push(collapsed)
  }
  return deduped.join('\n\n')
}
