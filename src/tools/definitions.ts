import { z } from 'zod'

import { applyMapping, planFill, type FillPlan } from '@/forms/mapper'
import { allowedValuesFor, buildFormMappingMessages, parseFormMapping } from '@/prompts/formMapper'
import type { Profile } from '@/types/vault'
import type { PageState } from '@/types/pageState'
import type { ToolContext, ToolSpec } from './types'

/**
 * Core tool set (spec §4). Tab management and research tools land in
 * Batches 8-9; these are the primitives the agent loop needs, plus the
 * form filler from spec §6.
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

const FillFormArgs = z.object({
  profile_id: z.string().optional(),
  use_llm: z.boolean().optional(),
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

/** What the model gets back: which fields, from which vault path — never the values. */
function describePlan(plan: FillPlan, failures: string[], profileName: string): string {
  const lines: string[] = []
  if (plan.fills.length > 0) {
    lines.push(
      `Filled ${plan.fills.length} field(s) from the "${profileName}" profile: ${plan.fills
        .map((fill) => `${fill.label} <- ${fill.profileKey}`)
        .join(', ')}.`,
    )
  }
  if (plan.blocked.length > 0) {
    lines.push(
      `Left for the user to handle (${plan.blocked.length}): ${plan.blocked
        .map((field) => `${field.label} — ${field.reason}`)
        .join('; ')}. These are highlighted in red on the page. Do not fill them yourself.`,
    )
  }
  if (plan.ambiguous.length > 0) {
    lines.push(`Still unmatched: ${plan.ambiguous.map((f) => f.label).join(', ')}.`)
  }
  if (plan.skipped.length > 0) {
    lines.push(`Skipped ${plan.skipped.length} field(s) with no suitable profile value.`)
  }
  if (failures.length > 0) lines.push(`Failed: ${failures.join('; ')}`)
  lines.push('The form was not submitted. Ask the user to review it, or use type_text with submit=true only when they agree.')
  return lines.join('\n')
}

async function resolveProfile(
  ctx: ToolContext,
  id?: string,
): Promise<{ profile: Profile } | { error: string }> {
  const vault = ctx.vault
  if (!vault || !vault.isUnlocked) {
    return { error: 'The profile vault is locked. Ask the user to unlock it in the Profiles tab.' }
  }
  if (id) {
    const profile = await vault.get(id)
    return profile ? { profile } : { error: `No profile with id "${id}" in the vault.` }
  }
  const profiles = await vault.list()
  if (profiles.length === 0) return { error: 'The vault has no profiles yet.' }
  if (profiles.length === 1) {
    const profile = await vault.get(profiles[0]!.id)
    return profile ? { profile } : { error: 'The only stored profile could not be read.' }
  }
  return {
    error: `Several profiles are stored (${profiles.map((p) => `${p.name}=${p.id}`).join(', ')}). Pass profile_id.`,
  }
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

  const fillForm: ToolSpec<typeof FillFormArgs> = {
    name: 'fill_form',
    description:
      'Fill the form on the current page from the user\'s profile vault. Matches fields by label, never fills payment/password/OTP/captcha/consent/upload fields, and never submits. Prefer this over typing each field yourself.',
    kind: 'write',
    schema: FillFormArgs,
    async run(args, ctx) {
      const resolved = await resolveProfile(ctx, args.profile_id)
      if ('error' in resolved) return { ok: false, content: resolved.error }
      const { profile } = resolved

      const fields = await ctx.host.formFields(ctx.tabId)
      if (fields.length === 0) return { ok: false, content: 'No form fields found on this page.' }

      let plan = planFill(fields, profile)
      if (plan.ambiguous.length > 0 && args.use_llm !== false && ctx.complete) {
        const asked = plan.ambiguous
        const result = await ctx.complete(buildFormMappingMessages(asked, ''), 'small')
        plan = applyMapping(plan, parseFormMapping(result.message.content ?? '', allowedValuesFor(asked)))
      }

      const failures: string[] = []
      for (const fill of plan.fills) {
        if (ctx.signal.aborted) break
        const typed = await ctx.host.act(ctx.tabId, { type: 'type', index: fill.index, text: fill.value })
        if (!typed.ok) failures.push(`${fill.label}: ${typed.error}`)
      }

      if (plan.blocked.length > 0) ctx.host.review(ctx.tabId, plan.blocked.map((field) => field.index))

      return { ok: failures.length === 0, content: describePlan(plan, failures, profile.name) }
    },
  }

  return [readPage, navigate, click, typeText, scroll, wait, askUser, finish, fillForm]
}
