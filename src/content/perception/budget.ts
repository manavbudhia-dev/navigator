import type { IndexedElement } from '@/types/pageState'

/** Rough token estimate: ~4 characters per token for mixed prose/markup. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface BudgetInput {
  elements: IndexedElement[]
  serialize: (el: IndexedElement) => string
  markdown: string
  metaText: string
  budget: number
}

export interface BudgetOutput {
  elementLines: string[]
  markdown: string
  truncatedElements: boolean
  truncatedMarkdown: boolean
  tokenEstimate: number
}

function truncateAtLineBoundary(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const cut = text.slice(0, maxChars)
  let breakAt = cut.lastIndexOf('\n\n')
  if (breakAt < maxChars * 0.5) breakAt = cut.lastIndexOf('\n')
  const safe = breakAt > 0 ? cut.slice(0, breakAt) : cut
  return { text: `${safe}\n…[truncated]`, truncated: true }
}

/**
 * Compresses page state to the token budget (spec §3): viewport-visible
 * elements always come first, off-viewport elements fill leftover element
 * allowance, and markdown takes whatever remains.
 */
export function applyTokenBudget(input: BudgetInput): BudgetOutput {
  const metaTokens = estimateTokens(input.metaText)
  const remaining = Math.max(input.budget - metaTokens, 0)

  const elementBudget = Math.floor(remaining * 0.6)
  const inViewport = input.elements.filter((el) => el.inViewport)
  const offViewport = input.elements.filter((el) => !el.inViewport)

  const lines: string[] = []
  let elementTokens = 0
  let truncatedElements = false

  for (const el of [...inViewport, ...offViewport]) {
    const line = input.serialize(el)
    const tokens = estimateTokens(line) + 1
    if (elementTokens + tokens > elementBudget) {
      truncatedElements = true
      if (el.inViewport) continue // keep scanning: a later shorter line may still fit
      break
    }
    lines.push(line)
    elementTokens += tokens
  }

  const markdownChars = Math.max(remaining - elementTokens, 100) * 4
  const { text: markdown, truncated: truncatedMarkdown } = truncateAtLineBoundary(
    input.markdown,
    markdownChars,
  )

  const tokenEstimate =
    metaTokens + elementTokens + estimateTokens(markdown)

  return { elementLines: lines, markdown, truncatedElements, truncatedMarkdown, tokenEstimate }
}
