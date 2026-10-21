import { runAgentTask } from '@/agent/loop'
import { complete } from '@/llm'
import { loadModelConfig } from '@/llm/config'
import { healGoal } from '@/prompts/recipes'
import { replayRecipe, startUrl } from '@/recipes/replay'
import { nextSlot, periodInMinutes } from '@/recipes/schedule'
import { getRecipe, listRecipes, saveRecipe } from '@/recipes/store'
import { recordAudit } from '@/safety/audit'
import { assessRisk } from '@/safety/risk'
import { decide } from '@/safety/modePolicy'
import { coreTools } from '@/tools/definitions'
import { tabTools } from '@/tools/tabTools'
import { ToolRegistry } from '@/tools/registry'
import type { AgentMode } from '@/types/agent'
import type { Recipe, RecipeStep } from '@/recipes/types'
import type { RiskAssessment } from '@/safety/risk'
import type { ToolContext, ToolKind } from '@/tools/types'

import { createToolHost, waitForTabComplete } from './host'
import { createTabOps } from './tabApi'
import { beginRun, endRun, hooksFor } from './runControl'
import { broadcast } from './task'
import { vault } from './vaultApi'

/**
 * Recipe replay in the service worker (spec §11).
 *
 * Same tools, same risk scorer, same approval channel as a live task — only the
 * model is taken out of the loop until a step stops working. A scheduled run has
 * nobody to ask, so anything needing approval stops the workflow with a note
 * instead of waving itself through.
 */

const KEEPALIVE_ALARM = 'navigator-recipe-keepalive'
const ALARM_PREFIX = 'recipe:'
const HEAL_STEPS = 4
const WINDOW_SIZE = { width: 1200, height: 800 }

export interface RecipeRunOptions {
  id: string
  values: Record<string, string>
  mode: AgentMode
  /** Started by a person in the panel, so an approval card has somewhere to go. */
  interactive: boolean
  /** Scheduled: opens its own background window instead of taking the active tab. */
  detached: boolean
}

export interface RecipeRunOutcome {
  ok: boolean
  detail: string
  healed: number
}

async function backgroundTab(url: string): Promise<{ tabId: number; windowId: number }> {
  const created = await chrome.windows.create({ url, focused: false, type: 'normal', ...WINDOW_SIZE })
  const windowId = created?.id
  const tab = created?.tabs?.[0]
  if (windowId === undefined || tab?.id === undefined) {
    throw new Error('Chrome refused to open a background window.')
  }
  await waitForTabComplete(tab.id)
  return { tabId: tab.id, windowId }
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab || tab.id === undefined) throw new Error('No active tab found.')
  return tab.id
}

function riskFor(step: RecipeStep, registry: ToolRegistry): { kind: ToolKind; assessment: RiskAssessment } {
  const kind = registry.get(step.tool)?.kind ?? 'write'
  const element =
    step.target === null
      ? null
      : {
          role: step.target.role,
          tag: step.target.selector.tag,
          inputType: step.target.inputType,
          text: step.target.label,
        }
  return { kind, assessment: assessRisk({ tool: step.tool, kind, element }) }
}

export async function runRecipeNow(options: RecipeRunOptions): Promise<RecipeRunOutcome> {
  const recipe = await getRecipe(options.id)
  if (recipe === null) throw new Error('No saved recipe with that id.')

  const config = await loadModelConfig()
  const host = createToolHost()
  const registry = new ToolRegistry([...coreTools(), ...tabTools()])
  const run = beginRun(`recipe "${recipe.name}"`)
  const { signal } = run.kill
  const hooks = hooksFor((event) => broadcast(event))

  let detachedWindow: number | null = null
  let tabId: number
  try {
    if (options.detached) {
      const url = startUrl(recipe, options.values)
      if (url === null) {
        throw new Error('This recipe has no navigate step, so a scheduled run has nowhere to start. Replay it yourself on the page you have open.')
      }
      const opened = await backgroundTab(url)
      tabId = opened.tabId
      detachedWindow = opened.windowId
    } else {
      tabId = await activeTabId()
    }
  } catch (error) {
    endRun()
    throw error
  }

  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 })

  const runId = crypto.randomUUID()
  const auditGoal = `Recipe: ${recipe.name}`
  let pageUrl: string | null = null

  const audit = async (
    step: RecipeStep,
    args: Record<string, unknown>,
    risk: RiskAssessment,
    decision: string,
    ok: boolean | null,
    detail: string,
    ms?: number,
  ): Promise<void> => {
    await recordAudit({
      goal: auditGoal,
      tool: step.tool,
      args,
      risk: risk.level,
      hardBlock: risk.hardBlock,
      decision,
      ok,
      detail,
      runId,
      ...(pageUrl === null ? {} : { url: pageUrl }),
      ...(step.target === null ? {} : { target: step.target }),
      ...(ms === undefined ? {} : { ms }),
    })
  }

  const tabOps = await createTabOps()
  const ctx: ToolContext = {
    host,
    tabId,
    signal,
    vault,
    tabs: tabOps,
    complete: async (messages, kind) => {
      const result = await complete(
        { messages, ...(kind === 'small' ? { maxTokens: 512 } : {}) },
        config,
        { kind, signal },
      )
      return result
    },
  }

  const execute = async (step: RecipeStep, index: number | null) => {
    const args: Record<string, unknown> = { ...step.args }
    if (index !== null) args['index'] = index
    const startedAt = Date.now()
    const result = await registry.execute(step.tool, args, ctx)
    const { assessment } = riskFor(step, registry)
    await audit(step, args, assessment, 'allow', result.ok, result.content.slice(0, 500), Date.now() - startedAt)
    return { ok: result.ok, content: result.content }
  }

  const permit = async (step: RecipeStep): Promise<boolean> => {
    const { kind, assessment } = riskFor(step, registry)
    const decision = decide(options.mode, kind, assessment)
    if (decision === 'allow') return true

    if (decision === 'block') {
      await audit(step, step.args, assessment, 'block', false, `Blocked by ${options.mode} mode.`)
      return false
    }

    if (!options.interactive) {
      await audit(step, step.args, assessment, 'block', false, 'A scheduled recipe never approves itself.')
      broadcast({ type: 'blocked', tool: step.tool, reason: 'Needs your approval, so the run stopped here.' })
      return false
    }

    const id = crypto.randomUUID()
    const summary = step.note === '' ? step.tool : step.note
    // The agent loop emits its own approval cards; a replay is not a loop, so
    // the card has to be put on the wire from here.
    broadcast({ type: 'approval', id, tool: step.tool, args: step.args, summary, level: assessment.level, reasons: assessment.reasons, hardBlock: assessment.hardBlock })
    const approved = await hooks.requestApproval({
      id,
      tool: step.tool,
      args: step.args,
      summary,
      level: assessment.level,
      reasons: assessment.reasons,
      hardBlock: assessment.hardBlock,
    })
    broadcast({ type: 'approval-resolved', id, approved })
    await audit(
      step,
      step.args,
      assessment,
      approved ? 'approved' : 'denied',
      approved ? null : false,
      approved ? 'Approved.' : 'User denied.',
    )
    return approved
  }

  // A healed step writes its own audit rows, under the same run id, so the
  // history entry shows the repair and its cost.
  const heal = async (step: RecipeStep, values: Readonly<Record<string, string>>, n: number) => {
    const outcome = await runAgentTask({
      goal: healGoal(recipe.name, n, step, values, 'the recorded step did not work on this page'),
      mode: options.mode,
      tabId,
      host,
      registry,
      config,
      hooks,
      signal,
      vault,
      tabs: tabOps,
      runId,
      maxSteps: HEAL_STEPS,
    })
    return outcome.success ? outcome.summary : null
  }

  try {
    const result = await replayRecipe(recipe, options.values, {
      refresh: async () => {
        pageUrl = (await host.pageState(tabId)).url
      },
      findIndex: (target) => host.locate(tabId, target),
      execute,
      permit,
      heal,
      signal,
    })

    const at = Date.now()
    await saveRecipe({ ...recipe, updatedAt: at, lastRun: { at, ok: result.ok, detail: result.detail, healed: result.healed } })
    broadcast({ type: 'recipe', id: recipe.id, name: recipe.name, ok: result.ok, detail: result.detail, healed: result.healed })
    return { ok: result.ok, detail: result.detail, healed: result.healed }
  } finally {
    endRun()
    chrome.alarms.clear(KEEPALIVE_ALARM)
    if (detachedWindow !== null) await chrome.windows.remove(detachedWindow).catch(() => undefined)
  }
}

/** Message-router entry point: turns a crash into an answer instead of a rejection. */
export async function startRecipeRun(options: RecipeRunOptions): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await runRecipeNow(options)
    return { ok: result.ok, ...(result.ok ? {} : { error: result.detail }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    broadcast({ type: 'failed', error: message })
    return { ok: false, error: message }
  }
}

/* ------------------------------------------------------------------ schedule */

function alarmName(id: string): string {
  return `${ALARM_PREFIX}${id}`
}

export async function scheduleRecipe(id: string): Promise<void> {
  const recipe = await getRecipe(id)
  if (recipe === null) throw new Error('No saved recipe with that id.')
  if (recipe.schedule === null) throw new Error('This recipe has no schedule to turn on.')
  armAlarm(recipe)
}

/**
 * Chrome clears alarms when the extension reloads, so the library is the truth
 * and the alarm clock is rebuilt from it on every worker boot.
 */
function armAlarm(recipe: Recipe): void {
  const schedule = recipe.schedule
  if (schedule === null) return
  chrome.alarms.create(alarmName(recipe.id), {
    delayInMinutes: nextSlot(schedule) / 60_000,
    periodInMinutes: periodInMinutes(schedule),
  })
}

export async function restoreSchedules(): Promise<void> {
  const recipes = await listRecipes()
  for (const recipe of recipes) armAlarm(recipe)
}

export async function unscheduleRecipe(id: string): Promise<void> {
  chrome.alarms.clear(alarmName(id))
  const recipe = await getRecipe(id)
  if (recipe === null) return
  await saveRecipe({ ...recipe, schedule: null, updatedAt: Date.now() })
}

/** Runs on its own: today's values are the ones the run was recorded with. */
async function runScheduled(id: string): Promise<void> {
  const recipe = await getRecipe(id)
  if (recipe === null) {
    chrome.alarms.clear(alarmName(id))
    return
  }
  const values: Record<string, string> = {}
  for (const param of recipe.params) values[param.name] = param.sample
  await startRecipeRun({ id, values, mode: 'auto', interactive: false, detached: true })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    void chrome.runtime.getPlatformInfo().catch(() => undefined)
    return
  }
  if (!alarm.name.startsWith(ALARM_PREFIX)) return
  void runScheduled(alarm.name.slice(ALARM_PREFIX.length))
})
