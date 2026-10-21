import { z } from 'zod'

import { clip } from '@/research/text'
import { DOWNLOAD_EXTENSIONS, TEXT_EXTENSIONS, guardFile, guardRemoteUrl, mimeFor } from '@/lib/files'
import { buildExtractMessages, parseExtraction, renderExtraction } from '@/prompts/extract'
import { pageStateToText } from './definitions'
import type { MemoryEntry } from '@/memory/recall'
import type { MemoryAccess, ToolContext, ToolSpec } from './types'

/**
 * Data tools (spec §4): pull information out of a page in a shape the user
 * asked for, take a picture, write a file, and remember things between runs.
 * None of them touch a control, so none of them need an element index.
 */

const ExtractArgs = z.object({
  item: z.string().min(1).max(80),
  fields: z.array(z.string().min(1).max(40)).min(1).max(12),
  many: z.boolean().optional(),
})

const EmptyArgs = z.object({})

const WriteFileArgs = z.object({
  file_name: z.string().min(1).max(120),
  content: z.string().min(1).max(200_000),
})

const DownloadArgs = z.object({
  url: z.string().min(1),
  file_name: z.string().min(1).max(120).optional(),
})

const RememberArgs = z.object({
  text: z.string().min(1).max(600),
  tags: z.array(z.string().min(1).max(24)).max(6).optional(),
  url: z.string().max(400).optional(),
})

const RecallArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
})

function requireMemory(ctx: ToolContext): { memory: MemoryAccess } | { error: string } {
  if (ctx.memory === undefined) return { error: 'Long-term memory is not available in this context.' }
  return { memory: ctx.memory }
}

/** Last path segment, or null when the URL does not name a file. */
function nameFromUrl(url: string): string | null {
  const last = new URL(url).pathname.split('/').filter((part) => part !== '').pop()
  if (last === undefined || !last.includes('.')) return null
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

function memoryLine(entry: MemoryEntry): string {
  const tags = entry.tags.length > 0 ? ` #${entry.tags.join(' #')}` : ''
  return `- ${entry.text}${tags}${entry.url === '' ? '' : ` (${clip(entry.url, 60)})`} [${new Date(entry.at).toISOString().slice(0, 10)}]`
}

export function dataTools(): ToolSpec[] {
  const extractStructured: ToolSpec<typeof ExtractArgs> = {
    name: 'extract_structured',
    description:
      'Read the current page and return named fields as records. Pass the item ("job posting", "invoice") and the field names you want, with many=true when the page holds a list. Values come from the page only — anything the page does not state comes back as null.',
    kind: 'read',
    schema: ExtractArgs,
    async run(args, ctx) {
      if (ctx.complete === undefined) {
        return { ok: false, content: 'Structured extraction needs a model call and none is configured here.' }
      }
      const fields = [...new Set(args.fields.map((field) => field.trim()).filter((field) => field !== ''))]
      if (fields.length === 0) return { ok: false, content: 'extract_structured needs at least one field name.' }
      const spec = { item: args.item.trim(), fields, many: args.many === true }

      const state = await ctx.host.pageState(ctx.tabId, true)
      const result = await ctx.complete(buildExtractMessages(spec, pageStateToText(state)), 'small')
      const records = parseExtraction(result.message.content ?? '', spec)
      return { ok: true, content: renderExtraction(records, spec) }
    },
  }

  const screenshot: ToolSpec<typeof EmptyArgs> = {
    name: 'screenshot',
    description:
      'Take a picture of the page as Chrome shows it and attach it to this step, so the user can see what you saw. It does not tell you anything the page text does not already say.',
    kind: 'read',
    schema: EmptyArgs,
    async run(_args, ctx) {
      const capture = await ctx.host.capture(ctx.tabId)
      if (capture === null) {
        return {
          ok: false,
          content: 'Chrome would not photograph this tab — it is not the visible tab in its window, or the page refuses capture. Bring it forward with switch_tab and try again.',
        }
      }
      return {
        ok: true,
        content: `Captured ${capture.width}x${capture.height} of the current view. It is attached to this step in the timeline; the picture itself is for the user, not for you — re-read the page for content.`,
        image: capture.dataUrl,
      }
    },
  }

  const writeFile: ToolSpec<typeof WriteFileArgs> = {
    name: 'write_file',
    description:
      'Write text you composed to a file in the user’s Downloads/Navigator folder. Use for a summary, a CSV of extracted rows, or a cover letter draft. It never overwrites: a name in use gets a number.',
    kind: 'write',
    schema: WriteFileArgs,
    async run(args, ctx) {
      const file = guardFile(args.file_name, TEXT_EXTENSIONS, 'text file')
      if (!file.ok) return { ok: false, content: file.error }
      const saved = await ctx.host.saveFile({ kind: 'text', fileName: file.path, text: args.content })
      if (!saved.ok) return { ok: false, content: saved.error }
      return {
        ok: true,
        content: `Wrote ${args.content.length} characters (${mimeFor(file.name)}) to ${saved.savedAs}.`,
      }
    },
  }

  const downloadFile: ToolSpec<typeof DownloadArgs> = {
    name: 'download_file',
    description:
      'Download a file the page links to (a PDF, an image, a spreadsheet) into the user’s Downloads/Navigator folder. Pass the real link href. Executables, scripts and SVG are refused.',
    kind: 'write',
    schema: DownloadArgs,
    async run(args, ctx) {
      const remote = guardRemoteUrl(args.url)
      if (!remote.ok) return { ok: false, content: remote.error }
      const suggested = args.file_name ?? nameFromUrl(remote.url)
      if (suggested === null) {
        return { ok: false, content: `${remote.url} does not name a file. Pass file_name with an allowed extension.` }
      }
      const file = guardFile(suggested, DOWNLOAD_EXTENSIONS, 'download')
      if (!file.ok) return { ok: false, content: file.error }
      const saved = await ctx.host.saveFile({ kind: 'url', fileName: file.path, url: remote.url })
      if (!saved.ok) return { ok: false, content: saved.error }
      return { ok: true, content: `Downloaded ${remote.url} to ${saved.savedAs}.` }
    },
  }

  const saveToMemory: ToolSpec<typeof RememberArgs> = {
    name: 'save_to_memory',
    description:
      'Remember one short fact across runs: a stated user preference, a login URL you were given, a detail you will need next time. One sentence per note, tagged. Never store passwords, card numbers or anything the vault is for.',
    kind: 'write',
    schema: RememberArgs,
    async run(args, ctx) {
      const memory = requireMemory(ctx)
      if ('error' in memory) return { ok: false, content: memory.error }
      if (/(password|passphrase|cvv|card number|secret|one[- ]?time code)/i.test(args.text)) {
        return {
          ok: false,
          content: 'That belongs in the encrypted profile vault, not in memory. Ask the user to store it in the Profiles tab.',
        }
      }
      const entry = await memory.memory.save({ text: args.text, ...(args.tags ? { tags: args.tags } : {}), ...(args.url ? { url: args.url } : {}) })
      return { ok: true, content: `Remembered: ${entry.text}` }
    },
  }

  const recallMemory: ToolSpec<typeof RecallArgs> = {
    name: 'recall_memory',
    description:
      'Look up what Navigator remembered from earlier runs, by keyword. Call it before asking the user for something they may already have told you. An empty query lists the most recent notes.',
    kind: 'read',
    schema: RecallArgs,
    async run(args, ctx) {
      const memory = requireMemory(ctx)
      if ('error' in memory) return { ok: false, content: memory.error }
      const entries = await memory.memory.recall(args.query, args.limit ?? 8)
      if (entries.length === 0) {
        return { ok: true, content: `Nothing remembered about “${clip(args.query, 60)}”. Ask the user.` }
      }
      return {
        ok: true,
        content: [`Memory (${entries.length} note(s), matched by keyword — these are past notes, not page facts):`, ...entries.map(memoryLine)].join('\n'),
      }
    },
  }

  return [extractStructured, screenshot, writeFile, downloadFile, saveToMemory, recallMemory]
}
