import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--force-device-scale-factor=1'],
})

const page = await browser.newPage()
await page.setViewport({ width: 420, height: 1100 })
await page.goto('http://localhost:5173/src/sidepanel/index.html', { waitUntil: 'networkidle0' })

const GOAL = 'Apply for the frontend job on the careers site'

// One successful run, written the way the agent writes it: the tools that
// touched a control carry the selector the replay will look for again.
const seeded = await page.evaluate(async (goal) => {
  const { db } = await import('/src/memory/db.ts')
  await db.audit.clear()
  await db.recipes.clear()
  const now = Date.now()
  const min = 60 * 1000
  const runId = 'run-apply'
  const base = { goal, runId, args: {}, risk: 'safe', hardBlock: null, decision: 'allow', ok: true, detail: '' }
  const field = {
    selector: {
      css: '#job-title',
      xpath: '/html/body/form/input[1]',
      textAnchor: 'Job title',
      bbox: { x: 40, y: 120, width: 260, height: 32 },
      tag: 'input',
      role: 'textbox',
      frameUrl: null,
    },
    label: 'Job title',
    role: 'textbox',
    inputType: 'text',
  }
  const button = {
    selector: {
      css: '#apply',
      xpath: '/html/body/form/button',
      textAnchor: 'Apply now',
      bbox: { x: 40, y: 200, width: 120, height: 36 },
      tag: 'button',
      role: 'button',
      frameUrl: null,
    },
    label: 'Apply now',
    role: 'button',
    inputType: null,
  }
  await db.audit.bulkAdd([
    { ...base, at: now - 9 * min, tool: 'navigate', args: { url: 'https://careers.test/jobs/frontend' }, detail: 'Opened https://careers.test/jobs/frontend' },
    { ...base, at: now - 8 * min, tool: 'read_page', detail: 'Page read: 24 elements' },
    { ...base, at: now - 7 * min, tool: 'type_text', risk: 'low', args: { index: 3, text: 'Senior Frontend Engineer' }, target: field, detail: 'Typed "Senior Frontend Engineer" into Job title' },
    { ...base, at: now - 6 * min, tool: 'click', risk: 'low', args: { index: 7 }, target: button, detail: 'Clicked Apply now' },
    { ...base, at: now - 5 * min, tool: 'finish', detail: 'Application form submitted', promptTokens: 900, completionTokens: 40 },
  ])
  return db.audit.count()
}, GOAL)

// The finished run offers itself as a recipe from the History tab.
await page.click('nav[aria-label="Sections"] button:nth-child(5)')
await new Promise((resolve) => setTimeout(resolve, 500))

const saved = await page.evaluate(async () => {
  const button = [...document.querySelectorAll('article[data-run] button')].find(
    (item) => (item.textContent ?? '').includes('Save as Recipe'),
  )
  if (!button) return { found: false }
  button.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const name = document.querySelector('input[aria-label="Recipe name"]')
  if (!name) return { found: true, form: false }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(name, 'Apply to frontend jobs')
  name.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  const save = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '') === 'Save recipe')
  save?.click()
  await new Promise((resolve) => setTimeout(resolve, 250))
  return {
    found: true,
    form: true,
    stamp: document.querySelector('[data-saved-recipe]')?.getAttribute('data-saved-recipe') ?? null,
    cards: document.querySelectorAll('article[data-recipe]').length,
  }
})

// What the library actually stored.
const stored = await page.evaluate(async () => {
  const { listRecipes } = await import('/src/recipes/store.ts')
  const recipes = await listRecipes()
  const recipe = recipes[0]
  return {
    count: recipes.length,
    steps: recipe?.steps.map((step) => step.tool) ?? null,
    args: recipe?.steps.map((step) => JSON.stringify(step.args)) ?? null,
    params: recipe?.params.map((param) => `${param.name}=${param.sample}`) ?? null,
    targets: recipe?.steps.map((step) => step.target?.label ?? '-') ?? null,
    origin: recipe?.originRunId ?? null,
    indicesGone: !(recipe?.steps ?? []).some((step) => 'index' in step.args),
  }
})

// Replay policy, checked against fakes: recorded steps first, model only for a
// step the page no longer has.
const replayed = await page.evaluate(async () => {
  const { listRecipes } = await import('/src/recipes/store.ts')
  const { replayRecipe } = await import('/src/recipes/replay.ts')
  const recipe = (await listRecipes())[0]
  const calls = []
  const deps = (failAt) => ({
    refresh: async () => {},
    findIndex: async (target) => {
      calls.push(`find:${target.label}`)
      return target.label === 'Apply now' && failAt ? null : 3
    },
    execute: async (step) => {
      calls.push(`run:${step.tool}`)
      return { ok: true, content: `${step.tool} ok` }
    },
    permit: async (step) => {
      calls.push(`permit:${step.tool}`)
      return true
    },
    heal: async (step) => {
      calls.push(`heal:${step.tool}`)
      return 'the model pressed the submit button it found instead'
    },
  })
  const clean = await replayRecipe(recipe, { job_title: 'Staff Engineer' }, deps(false))
  const cleanCalls = [...calls]
  calls.length = 0
  const drifted = await replayRecipe(recipe, { job_title: 'Staff Engineer' }, deps(true))
  const driftedCalls = [...calls]
  calls.length = 0
  let refused = null
  try {
    await replayRecipe(recipe, {}, deps(false))
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error)
  }
  return {
    clean: { ok: clean.ok, detail: clean.detail, healed: clean.healed },
    cleanCalls,
    drifted: { ok: drifted.ok, healed: drifted.healed, modes: drifted.steps.map((step) => step.mode) },
    driftedCalls,
    refused,
  }
})

// The variables the replay form asks for, and the schedule the card can set.
const ui = await page.evaluate(async () => {
  const card = document.querySelector('article[data-recipe]')
  const fields = [...(card?.querySelectorAll('label') ?? [])].map((label) => {
    const input = label.querySelector('input')
    return `${(label.textContent ?? '').trim()}=${input?.value ?? ''}`
  })
  const clock = card?.querySelector('button[aria-label^="Schedule"]')
  clock?.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const turn = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '') === 'Turn on')
  turn?.click()
  await new Promise((resolve) => setTimeout(resolve, 250))
  const { listRecipes } = await import('/src/recipes/store.ts')
  const saved = (await listRecipes())[0]
  return {
    fields,
    stepsShown: card?.querySelectorAll('ol li').length ?? 0,
    schedule: saved?.schedule ?? null,
    cardText: (document.querySelector('article[data-recipe]')?.textContent ?? '').slice(0, 200),
  }
})

// A workflow file round-trips, and a colliding import becomes a copy.
const portable = await page.evaluate(async () => {
  const { importRecipesJson, listRecipes, recipesExportJson } = await import('/src/recipes/store.ts')
  const before = await listRecipes()
  const json = recipesExportJson([before[0]])
  const round = JSON.parse(json)
  const result = await importRecipesJson(json)
  const after = await listRecipes()
  let rejected = null
  try {
    await importRecipesJson('{"recipes":[]}')
  } catch (error) {
    rejected = error instanceof Error ? error.message : String(error)
  }
  let notJson = null
  try {
    await importRecipesJson('hello')
  } catch (error) {
    notJson = error instanceof Error ? error.message : String(error)
  }
  return {
    app: round.app,
    kind: round.kind,
    fileSteps: round.recipes[0]?.steps.length ?? 0,
    result,
    grew: after.length - before.length,
    originalIntact: (await after.find((item) => item.id === before[0].id))?.name === before[0].name,
    rejected,
    notJson,
  }
})

// nextSlot never promises a delay Chrome would refuse.
const timing = await page.evaluate(async () => {
  const { nextSlot, periodInMinutes } = await import('/src/recipes/schedule.ts')
  const daily = { frequency: 'daily', hour: 9, minute: 30, dayOfWeek: null }
  const weekly = { frequency: 'weekly', hour: 6, minute: 0, dayOfWeek: 0 }
  const at = (delay) => new Date(Date.now() + delay)
  return {
    dailyAtLeastAMinute: nextSlot(daily) >= 60_000,
    dailyLandsOnTime: (() => {
      const d = at(nextSlot(daily))
      return d.getHours() === 9 && d.getMinutes() === 30
    })(),
    weeklyLandsOnSunday: at(nextSlot(weekly)).getDay() === 0,
    periods: [periodInMinutes(daily), periodInMinutes(weekly)],
  }
})

await page.screenshot({ path: join(tmpdir(), 'navigator-recipes.png'), fullPage: true })
await browser.close()

const checks = {
  runSeeded: seeded === 5,
  saveOffered: saved.found && saved.form,
  savedByName: saved.stamp === 'Apply to frontend jobs',
  oneCardInLibrary: saved.cards === 1 && stored.count === 1,
  onlyRealStepsStored: JSON.stringify(stored.steps) === JSON.stringify(['navigate', 'type_text', 'click']),
  elementIndicesForgotten: stored.indicesGone === true,
  typedValueBecameAVariable: JSON.stringify(stored.params) === JSON.stringify(['job_title=Senior Frontend Engineer']),
  controlsRemembered: JSON.stringify(stored.targets) === JSON.stringify(['-', 'Job title', 'Apply now']),
  linksBackToRun: stored.origin === 'run-apply',
  recordedStepsRunFirst:
    replayed.clean.ok &&
    replayed.clean.healed === 0 &&
    replayed.clean.detail.includes('3 step(s) replayed as recorded') &&
    replayed.cleanCalls.includes('find:Job title') &&
    replayed.cleanCalls.includes('find:Apply now') &&
    replayed.cleanCalls.filter((call) => call.startsWith('run:')).length === 3,
  deadStepIsHealed:
    replayed.drifted.ok &&
    replayed.drifted.healed === 1 &&
    JSON.stringify(replayed.drifted.modes) === JSON.stringify(['recorded', 'recorded', 'healed']) &&
    replayed.driftedCalls.includes('heal:click'),
  missingValueRefused: replayed.refused !== null && replayed.refused.includes('needs values for: job_title'),
  variablesStartOnSamples: JSON.stringify(ui.fields) === JSON.stringify(['Job title=Senior Frontend Engineer']),
  scheduleStored: ui.schedule?.frequency === 'daily' && ui.schedule?.hour === 9,
  scheduleShownOnCard: ui.cardText.includes('Every day at'),
  exportIsNavigatorFile: portable.app === 'navigator' && portable.kind === 'recipes' && portable.fileSteps === 3,
  importCopiesNeverOverwrite:
    portable.result.imported === 1 && portable.result.collided === 1 && portable.grew === 1 && portable.originalIntact,
  badFileRefused: portable.rejected !== null && portable.notJson === 'That file is not JSON.',
  alarmTimingValid: timing.dailyAtLeastAMinute && timing.dailyLandsOnTime && timing.weeklyLandsOnSunday,
  alarmPeriods: JSON.stringify(timing.periods) === JSON.stringify([1440, 10080]),
}

const failed = Object.entries(checks).filter(([, ok]) => !ok)
console.log(JSON.stringify({ seeded, saved, stored, replayed, ui, portable, timing, checks }, null, 2))
console.log(
  failed.length === 0
    ? 'RECIPE CHECK: PASS'
    : `RECIPE CHECK: FAIL ${failed.map(([name]) => name).join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
