import { z } from 'zod'

import { hostOf, tabLabel } from '@/tabs/model'
import type { TabMatch, TabReport } from '@/tabs/types'
import type { ToolContext, ToolSpec } from './types'

/**
 * Tab tools (spec §8): the agent's view of the whole browser, not just the tab
 * it started in. Every bulk operation goes through the manager so the same
 * protections apply as in the panel — pinned tabs, the active tab, the last
 * tab of a window, and the tab the agent is working in are never collateral.
 */

const ScopeSchema = z.enum(['all', 'others'])

const ScopedArgs = z.object({
  host: z.string().optional(),
  query: z.string().optional(),
  scope: ScopeSchema.optional(),
})

const QueryArgs = z.object({ query: z.string().min(1) })
const EmptyArgs = z.object({})
const FreeArgs = z.object({ max_tabs: z.number().int().min(1).max(25).optional() })
const SaveArgs = z.object({
  name: z.string().min(1).max(60),
  note: z.string().max(400).optional(),
  tags: z.array(z.string().min(1).max(24)).max(6).optional(),
})
const RestoreArgs = z.object({ name: z.string().min(1).max(60).optional() })

/** host > query > explicit scope > all */
function matchOf(args: z.infer<typeof ScopedArgs>): TabMatch {
  if (args.host !== undefined) return { scope: 'host', host: args.host.toLowerCase() }
  if (args.query !== undefined) return { scope: 'query', query: args.query }
  if (args.scope === 'others') return { scope: 'others' }
  return { scope: 'all' }
}

function requireTabs(ctx: ToolContext): { ops: NonNullable<ToolContext['tabs']> } | { error: string } {
  if (ctx.tabs === undefined) return { error: 'The tab manager is not available in this context.' }
  return { ops: ctx.tabs }
}

/** What the model reads back: one line per change, plus the undo hint. */
export function reportToText(report: TabReport): string {
  const lines = report.lines.map((line) => `- ${line.text}`)
  if (report.found.length > 0) {
    lines.push('', 'Matches:')
    for (const result of report.found) {
      lines.push(`- [tab ${result.tab.id}] ${tabLabel(result.tab)} (${hostOf(result.tab.url) || 'no host'}) · ${result.where} · ${result.snippet}`)
    }
  }
  if (report.stale.length > 0) {
    lines.push('', 'Untouched:')
    for (const entry of report.stale) lines.push(`- [tab ${entry.tab.id}] ${tabLabel(entry.tab)} · ${entry.daysIdle} day(s) idle`)
  }
  if (report.sessions.length > 0) {
    lines.push('', 'Sessions:')
    for (const session of report.sessions) lines.push(`- "${session.name}" · ${session.tabs.length} tab(s) · ${session.tags.join(', ')}`)
  }
  const undo = report.undo === null ? '' : ` UNDO is available for ${report.undo.tabs} closed tab(s) for 60s.`
  const tail = report.closed > 0 || report.grouped > 0 || report.freedBytes > 0 ? '' : ' Nothing was changed.'
  return [report.summary + tail, ...lines, undo.trim()].filter((line) => line !== '').join('\n')
}

async function guard(ctx: ToolContext) {
  return { guard: { keepIds: [ctx.tabId] }, signal: ctx.signal }
}

export function tabTools(): ToolSpec[] {
  const listTabs: ToolSpec<typeof EmptyArgs> = {
    name: 'list_tabs',
    description:
      'List every open tab across all windows (id, title, URL, pinned/group state). Use this before switching, grouping or closing tabs.',
    kind: 'read',
    schema: EmptyArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'list', match: { scope: 'all' } }, await guard(ctx))
      const lines = report.tabs.map(
        (tab) =>
          `[${tab.id}] ${tabLabel(tab)} — ${tab.url}${tab.pinned ? ' (pinned)' : ''}${tab.active ? ' (active)' : ''}${
            tab.groupId >= 0 ? ` (group ${tab.groupId})` : ''
          }${tab.discarded ? ' (suspended)' : ''}`,
      )
      return { ok: report.ok, content: [`Open tabs (${report.tabs.length}):`, ...lines].join('\n') }
    },
  }

  const switchTab: ToolSpec<typeof QueryArgs> = {
    name: 'switch_tab',
    description: 'Bring the tab that best matches the description to the foreground and make it active.',
    kind: 'write',
    schema: QueryArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'switch', query: args.query }, await guard(ctx))
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const closeTabs: ToolSpec<typeof ScopedArgs> = {
    name: 'close_tabs',
    description:
      'Close tabs by host (e.g. "youtube.com"), by topic query, or scope=all/others. Pinned tabs, the active tab and the tab you are working in are kept, and the user can undo for 60s.',
    kind: 'write',
    schema: ScopedArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'close', match: matchOf(args) }, await guard(ctx))
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const groupTabs: ToolSpec<typeof ScopedArgs> = {
    name: 'group_tabs',
    description:
      'Cluster tabs by similarity of title and domain into Chrome tab groups, each named and coloured. Narrow with host or query; without arguments it groups everything ungrouped.',
    kind: 'write',
    schema: ScopedArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'group', match: matchOf(args) }, await guard(ctx))
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const mergeDuplicates: ToolSpec<typeof EmptyArgs> = {
    name: 'close_duplicate_tabs',
    description: 'Close tabs whose canonical URL is already open elsewhere, keeping the best copy of each page.',
    kind: 'write',
    schema: EmptyArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'merge', match: { scope: 'all' } }, await guard(ctx))
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const searchTabsTool: ToolSpec<typeof QueryArgs> = {
    name: 'search_tabs',
    description:
      'Find tabs by meaning across titles, URLs and the indexed text of pages. Use for "the tab with the pricing page".',
    kind: 'read',
    schema: QueryArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'find', query: args.query }, await guard(ctx))
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const indexPages: ToolSpec<typeof EmptyArgs> = {
    name: 'index_open_pages',
    description:
      'Read the text of the open pages into the local search index so search_tabs can look inside them. Run it once before a content search.',
    kind: 'read',
    schema: EmptyArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'index' }, await guard(ctx))
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const freeMemory: ToolSpec<typeof FreeArgs> = {
    name: 'suspend_heavy_tabs',
    description:
      'Suspend the heaviest inactive tabs with discard(): they keep their place and reload when clicked. Never touches pinned, active or your own tab.',
    kind: 'write',
    schema: FreeArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run(
        { kind: 'free', match: { scope: 'all' }, ...(args.max_tabs === undefined ? {} : { maxTabs: args.max_tabs }) },
        await guard(ctx),
      )
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const staleTabs: ToolSpec<typeof EmptyArgs> = {
    name: 'list_stale_tabs',
    description: 'Report tabs untouched for a week or more. It only reports: closing them needs a separate close_tabs call the user approves.',
    kind: 'read',
    schema: EmptyArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'stale', days: 7 }, await guard(ctx))
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const saveSession: ToolSpec<typeof SaveArgs> = {
    name: 'save_session',
    description: 'Snapshot every open tab under a name and tags so the user can restore the whole session later.',
    kind: 'write',
    schema: SaveArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run(
        {
          kind: 'save',
          name: args.name,
          ...(args.note === undefined ? { note: '' } : { note: args.note }),
          tags: args.tags ?? [],
        },
        await guard(ctx),
      )
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const restoreSession: ToolSpec<typeof RestoreArgs> = {
    name: 'restore_session',
    description: 'Reopen the tabs of a saved session, skipping URLs that are already open. Omit name for the newest session.',
    kind: 'write',
    schema: RestoreArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run(
        { kind: 'restore', ...(args.name === undefined ? { name: '' } : { name: args.name }) },
        await guard(ctx),
      )
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  const undoTabs: ToolSpec<typeof EmptyArgs> = {
    name: 'undo_tab_close',
    description: 'Reopen the tabs closed by the last bulk close or merge, if it happened less than 60 seconds ago.',
    kind: 'write',
    schema: EmptyArgs,
    async run(args, ctx) {
      const tabs = requireTabs(ctx)
      if ('error' in tabs) return { ok: false, content: tabs.error }
      const report = await tabs.ops.run({ kind: 'undo' }, await guard(ctx))
      return { ok: report.ok, content: reportToText(report) }
    },
  }

  return [
    listTabs,
    switchTab,
    closeTabs,
    groupTabs,
    mergeDuplicates,
    searchTabsTool,
    indexPages,
    freeMemory,
    staleTabs,
    saveSession,
    restoreSession,
    undoTabs,
  ]
}
