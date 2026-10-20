import { z } from 'zod'

import type { PageState } from '@/types/pageState'
import type { ToolSpec } from './types'

/**
 * Core tool set (spec §4). Tab management, form filling and research tools
 * land in Batches 7-9; these are the primitives the agent loop needs.
 */

const ReadPageArgs = z.object({
  include_off_viewport: z.boolean().optional(),
})

const NavigateArgs = z.object({
  url: z.string().min(1),
})

const ClickArgs = z.object({
  index: z.number().int().min(0),
})

const TypeArgs = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  submit: z.boolean().optional(),
})

const ScrollArgs = z.object({
  direction: z.enum(['down', 'up']),
  amount: z.number().min(0.1).max(3).optional(),
  index: z.number().int().min(0).optional(),
})

const WaitArgs = z.object({
  seconds: z.number().min(0).max(30),
})

const AskUserArgs = z.object({
  question: z.string().min(1),
})

const FinishArgs = z.object({
  summary: z.string().min(1),
  success: z.boolean(),
})

/** https:// is added when the model omits a scheme. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function pageStateToText(state: PageState): string {
  const meta = `URL: ${state.url}\nTitle: ${state.title}\nScroll: ${state.scrollPercent}% | login: ${state.loginState}`
  return [meta, ...state.elementLines, '', state.markdown].join('\n')
}

export function coreTools(): ToolSpec[] {
  const readPage: ToolSpec<typeof ReadPageArgs> = {
    name: 'read_page',
    description:
      'Read the current page: numbered interactive elements and the article text. Always call this before clicking or typing so element indices are fresh.',
    kind: 'read',
    schema: ReadPageArgs,
    async run(args, ctx) {
      const state = await ctx.host.pageState(ctx.tabId, args.include_off_viewport)
      return { ok: true, content: pageStateToText(state) }
    },
  }

  const navigate: ToolSpec<typeof NavigateArgs> = {
    name: 'navigate',
    description: 'Open a URL in the current tab.',
    kind: 'write',
    schema: NavigateArgs,
    async run(args, ctx) {
      const url = normalizeUrl(args.url)
      await ctx.host.navigate(ctx.tabId, url)
      return { ok: true, content: `Navigated to ${url}.` }
    },
  }

  const click: ToolSpec<typeof ClickArgs> = {
    name: 'click',
    description: 'Click the element with the given index from the last read_page result.',
    kind: 'write',
    schema: ClickArgs,
    async run(args, ctx) {
      const result = await ctx.host.act(ctx.tabId, { type: 'click', index: args.index })
      return { ok: result.ok, content: result.ok ? result.detail : result.error }
    },
  }

  const typeText: ToolSpec<typeof TypeArgs> = {
    name: 'type_text',
    description:
      'Type text into the field with the given index (input, textarea or select). Set submit=true to press Enter / submit the form afterwards.',
    kind: 'write',
    schema: TypeArgs,
    async run(args, ctx) {
      const result = await ctx.host.act(ctx.tabId, {
        type: 'type',
        index: args.index,
        text: args.text,
        ...(args.submit !== undefined ? { submit: args.submit } : {}),
      })
      return { ok: result.ok, content: result.ok ? result.detail : result.error }
    },
  }

  const scroll: ToolSpec<typeof ScrollArgs> = {
    name: 'scroll',
    description:
      'Scroll the page (or one scrollable element) down or up by a fraction of the viewport. amount=1.0 scrolls one screen.',
    kind: 'write',
    schema: ScrollArgs,
    async run(args, ctx) {
      const result = await ctx.host.act(ctx.tabId, {
        type: 'scroll',
        direction: args.direction,
        ...(args.amount !== undefined ? { amount: args.amount } : {}),
        ...(args.index !== undefined ? { index: args.index } : {}),
      })
      return { ok: result.ok, content: result.ok ? result.detail : result.error }
    },
  }

  const wait: ToolSpec<typeof WaitArgs> = {
    name: 'wait',
    description: 'Wait for the page to settle (loading, animations, async results).',
    kind: 'read',
    schema: WaitArgs,
    async run(args, ctx) {
      await ctx.host.sleep(Math.round(args.seconds * 1000), ctx.signal)
      return { ok: true, content: `Waited ${args.seconds}s.` }
    },
  }

  const askUser: ToolSpec<typeof AskUserArgs> = {
    name: 'ask_user',
    description:
      'Pause and ask the user a question. Use for missing information, CAPTCHAs, 2FA, or anything you cannot do autonomously.',
    kind: 'control',
    schema: AskUserArgs,
    async run(args) {
      // The loop intercepts this tool before `run` and waits for the reply.
      return { ok: true, content: `Asked the user: ${args.question}` }
    },
  }

  const finish: ToolSpec<typeof FinishArgs> = {
    name: 'finish',
    description: 'End the task: report what was accomplished (success=true) or why it failed.',
    kind: 'control',
    schema: FinishArgs,
    async run(args) {
      // The loop intercepts this tool before `run` to stop the loop.
      return { ok: args.success, content: args.summary }
    },
  }

  return [readPage, navigate, click, typeText, scroll, wait, askUser, finish]
}
