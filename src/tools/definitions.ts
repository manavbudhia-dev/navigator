import { z } from 'zod'

import { applyMapping, planFill, type FillPlan } from '@/forms/mapper'
import { allowedValuesFor, buildFormMappingMessages, parseFormMapping } from '@/prompts/formMapper'
import type { ActResult } from '@/types/actions'
import type { Profile } from '@/types/vault'
import type { PageState } from '@/types/pageState'
import type { ToolContext, ToolResult, ToolSpec } from './types'

/**
 * Core tool set (spec §4). Tab management and research tools land in
 * Batches 8-9; these are the primitives the agent loop needs, plus the
 * form filler from spec §6.
 */

const ReadPageArgs = z.object({
  include_off_viewport: z.boolean().optional(),
})

const NavigateArgs = z.object({
  url: z.string().trim().min(1),
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

const HoverArgs = z.object({ index: z.number().int().min(0) })

const PressKeyArgs = z.object({
  key: z.string().min(1),
  index: z.number().int().min(0).optional(),
})

const SelectArgs = z.object({
  index: z.number().int().min(0),
  value: z.string().min(1),
})

const CheckArgs = z.object({
  index: z.number().int().min(0),
  state: z.boolean(),
})

const UploadArgs = z.object({
  index: z.number().int().min(0),
  file_ref: z.string().min(1),
  profile_id: z.string().optional(),
})

const DragArgs = z.object({
  from_index: z.number().int().min(0),
  to_index: z.number().int().min(0),
})

const WaitForArgs = z.object({
  condition: z.enum(['load', 'selector', 'text', 'quiet']),
  value: z.string().optional(),
  timeout_seconds: z.number().min(0.5).max(60).optional(),
})

/** Tools that take nothing at all: go_back, go_forward, reload. */
const EmptyArgs = z.object({})

/** Only text can be attached, so the mime type is guessed from the name. */
const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  xml: 'application/xml',
  pdf: 'application/pdf',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function mimeFor(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? 'text/plain'
}

/** A stored document by name, or by kind when the name is not typed out. */
export function pickStoredDocument(profile: Profile, ref: string) {
  const wanted = ref.trim().toLowerCase()
  return (
    profile.documents.find((doc) => doc.fileName.toLowerCase() === wanted) ??
    profile.documents.find((doc) => doc.kind === wanted) ??
    null
  )
}

/** https:// is added when the model omits a scheme. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function pageStateToText(state: PageState): string {
  const meta = `URL: ${state.url}\nTitle: ${state.title}\nScroll: ${state.scrollPercent}% | login: ${state.loginState}`
  return [meta, ...state.elementLines, '', state.markdown].join('\n')
}

/**
 * What an action did, for the transcript — plus the control it touched, which
 * only the audit log and recipes ever see (spec §11).
 */
function actResult(result: ActResult): ToolResult {
  if (!result.ok) return { ok: false, content: result.error }
  return {
    ok: true,
    content: result.detail,
    ...(result.target !== undefined ? { target: result.target } : {}),
  }
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
      return actResult(await ctx.host.act(ctx.tabId, { type: 'click', index: args.index }))
    },
  }

  const typeText: ToolSpec<typeof TypeArgs> = {
    name: 'type_text',
    description:
      'Type text into the field with the given index (input, textarea or select). Set submit=true to press Enter / submit the form afterwards.',
    kind: 'write',
    schema: TypeArgs,
    async run(args, ctx) {
      return actResult(
        await ctx.host.act(ctx.tabId, {
          type: 'type',
          index: args.index,
          text: args.text,
          ...(args.submit !== undefined ? { submit: args.submit } : {}),
        }),
      )
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

  const hover: ToolSpec<typeof HoverArgs> = {
    name: 'hover',
    description:
      'Move the pointer over an element to open a menu or tooltip. Re-read the page afterwards: the revealed items are new elements.',
    kind: 'write',
    schema: HoverArgs,
    async run(args, ctx) {
      return actResult(await ctx.host.act(ctx.tabId, { type: 'hover', index: args.index }))
    },
  }

  const pressKey: ToolSpec<typeof PressKeyArgs> = {
    name: 'press_key',
    description:
      'Press a key or combo ("Enter", "Escape", "Tab", "PageDown", "ctrl+a"). Pass index to aim it at one element, omit it for the focused element.',
    kind: 'write',
    schema: PressKeyArgs,
    async run(args, ctx) {
      return actResult(
        await ctx.host.act(ctx.tabId, {
          type: 'press_key',
          key: args.key,
          ...(args.index !== undefined ? { index: args.index } : {}),
        }),
      )
    },
  }

  const selectOption: ToolSpec<typeof SelectArgs> = {
    name: 'select_option',
    description: 'Choose an option in a native dropdown by its visible text.',
    kind: 'write',
    schema: SelectArgs,
    async run(args, ctx) {
      return actResult(await ctx.host.act(ctx.tabId, { type: 'select', index: args.index, value: args.value }))
    },
  }

  const check: ToolSpec<typeof CheckArgs> = {
    name: 'check',
    description:
      'Tick or untick a checkbox or radio button. Consent, subscription and "confirm delete" boxes are refused without the user.',
    kind: 'write',
    schema: CheckArgs,
    async run(args, ctx) {
      return actResult(await ctx.host.act(ctx.tabId, { type: 'check', index: args.index, checked: args.state }))
    },
  }

  const uploadFile: ToolSpec<typeof UploadArgs> = {
    name: 'upload_file',
    description:
      'Attach a document saved in the profile vault to a file input. file_ref is the document name, or "resume" / "cover-letter". Navigator cannot read your disk, so only stored documents can be attached — ask the user to pick anything else.',
    kind: 'write',
    schema: UploadArgs,
    async run(args, ctx) {
      const resolved = await resolveProfile(ctx, args.profile_id)
      if ('error' in resolved) return { ok: false, content: resolved.error }
      const doc = pickStoredDocument(resolved.profile, args.file_ref)
      if (doc === null) {
        const stored = resolved.profile.documents.map((d) => d.fileName || d.kind).join(', ')
        return { ok: false, content: `No "${args.file_ref}" in the "${resolved.profile.name}" profile. Stored: ${stored || 'nothing'}.` }
      }
      if (doc.text === undefined || doc.text === '') {
        return {
          ok: false,
          content: `${doc.fileName} is stored as a name only — its contents were never saved, so there is nothing to attach. Ask the user to choose the file.`,
        }
      }
      return actResult(
        await ctx.host.act(ctx.tabId, {
          type: 'upload',
          index: args.index,
          file: { name: doc.fileName || `${doc.kind}.txt`, mime: mimeFor(doc.fileName), text: doc.text },
        }),
      )
    },
  }

  const dragAndDrop: ToolSpec<typeof DragArgs> = {
    name: 'drag_and_drop',
    description: 'Drag one element onto another (a sort handle onto a list slot, a file chip onto a drop zone).',
    kind: 'write',
    schema: DragArgs,
    async run(args, ctx) {
      return actResult(
        await ctx.host.act(ctx.tabId, { type: 'drag', fromIndex: args.from_index, toIndex: args.to_index }),
      )
    },
  }

  const goBack: ToolSpec<typeof EmptyArgs> = {
    name: 'go_back',
    description: 'One step back in this tab’s history.',
    kind: 'write',
    schema: EmptyArgs,
    async run(_args, ctx) {
      await ctx.host.goBack(ctx.tabId)
      return { ok: true, content: 'Went back one page. Re-read the page.' }
    },
  }

  const goForward: ToolSpec<typeof EmptyArgs> = {
    name: 'go_forward',
    description: 'One step forward in this tab’s history.',
    kind: 'write',
    schema: EmptyArgs,
    async run(_args, ctx) {
      await ctx.host.goForward(ctx.tabId)
      return { ok: true, content: 'Went forward one page. Re-read the page.' }
    },
  }

  const reload: ToolSpec<typeof EmptyArgs> = {
    name: 'reload',
    description: 'Reload the current tab. Use when the page looks broken or stale.',
    kind: 'write',
    schema: EmptyArgs,
    async run(_args, ctx) {
      await ctx.host.reload(ctx.tabId)
      return { ok: true, content: 'Reloaded the page. Re-read it.' }
    },
  }

  const openTab: ToolSpec<typeof NavigateArgs> = {
    name: 'open_tab',
    description:
      'Open a URL in a new background tab and keep working here. Use switch_tab to move into it; close_tabs to clean up.',
    kind: 'write',
    schema: NavigateArgs,
    async run(args, ctx) {
      const url = normalizeUrl(args.url)
      const tabId = await ctx.host.openTab(url)
      return { ok: true, content: `Opened ${url} in background tab ${tabId}.` }
    },
  }

  const waitFor: ToolSpec<typeof WaitForArgs> = {
    name: 'wait_for',
    description:
      'Wait until the page really is ready: "load" for the tab to finish loading, "selector" for a CSS selector to appear, "text" for a string to show up, "quiet" for the DOM to stop changing. Prefer this over wait.',
    kind: 'read',
    schema: WaitForArgs,
    async run(args, ctx) {
      const timeoutMs = Math.round((args.timeout_seconds ?? 10) * 1000)
      if (args.condition === 'load') {
        const done = await ctx.host.waitForLoad(ctx.tabId, timeoutMs)
        return {
          ok: true,
          content: done
            ? 'The tab finished loading. Re-read the page.'
            : `The tab was still loading after ${args.timeout_seconds ?? 10}s. Re-read the page and see what arrived.`,
        }
      }
      const value = args.value ?? ''
      if (value === '' && args.condition !== 'quiet') {
        return { ok: false, content: `wait_for "${args.condition}" needs a value.` }
      }
      try {
        return actResult(await ctx.host.waitFor(ctx.tabId, args.condition, value, timeoutMs))
      } catch (error) {
        return { ok: false, content: error instanceof Error ? error.message : String(error) }
      }
    },
  }

  return [
    readPage,
    navigate,
    click,
    typeText,
    scroll,
    wait,
    askUser,
    finish,
    fillForm,
    hover,
    pressKey,
    selectOption,
    check,
    uploadFile,
    dragAndDrop,
    goBack,
    goForward,
    reload,
    openTab,
    waitFor,
  ]
}
