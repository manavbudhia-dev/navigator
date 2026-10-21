import { db, type RecipeRow } from '@/memory/db'

import { RecipeFileSchema, RecipeSchema, type Recipe } from './types'

/**
 * The recipe library (spec §11). IndexedDB holds one document per workflow,
 * exactly like the tab sessions do, so the side panel and the service worker
 * read the same list without a message round-trip.
 *
 * A row that fails validation is skipped rather than thrown: one hand-edited
 * import must not blank the whole library.
 */

function toRow(recipe: Recipe): RecipeRow {
  return {
    id: recipe.id,
    name: recipe.name,
    goal: recipe.goal,
    updatedAt: recipe.updatedAt,
    scheduled: recipe.schedule !== null,
    document: recipe,
  }
}

export async function saveRecipe(recipe: Recipe): Promise<void> {
  await db.recipes.put(toRow(RecipeSchema.parse(recipe)))
}

export async function listRecipes(): Promise<Recipe[]> {
  const rows = await db.recipes.orderBy('updatedAt').reverse().toArray()
  const out: Recipe[] = []
  for (const row of rows) {
    const parsed = RecipeSchema.safeParse(row.document)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const row = await db.recipes.get(id)
  if (row === undefined) return null
  const parsed = RecipeSchema.safeParse(row.document)
  return parsed.success ? parsed.data : null
}

export async function deleteRecipe(id: string): Promise<void> {
  await db.recipes.delete(id)
}

/** A workflow file, so a recipe can move between machines or into git. */
export function recipesExportJson(recipes: readonly Recipe[], exportedAt = Date.now()): string {
  const file = RecipeFileSchema.parse({
    app: 'navigator',
    kind: 'recipes',
    version: 1,
    exportedAt,
    recipes: [...recipes],
  })
  return JSON.stringify(file, null, 2)
}

export function recipeFileJson(recipe: Recipe, exportedAt = Date.now()): string {
  return recipesExportJson([recipe], exportedAt)
}

export interface ImportResult {
  imported: number
  /** Recipes whose id already existed; they were kept as new copies, not overwrites. */
  collided: number
}

/**
 * Import a workflow file. Never replaces an existing recipe: a name clash in a
 * shared file would otherwise quietly delete someone's saved work.
 */
export async function importRecipesJson(text: string): Promise<ImportResult> {
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    throw new Error('That file is not JSON.')
  }

  const parsed = RecipeFileSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    throw new Error(`Not a Navigator recipe file. ${where}${issue?.message ?? 'schema mismatch'}`)
  }

  const existing = new Set((await db.recipes.toArray()).map((row) => row.id))
  let imported = 0
  let collided = 0

  for (const recipe of parsed.data.recipes) {
    // A colliding id is re-issued instead of overwritten, and the copy floats to
    // the top of the library so it is obvious that something new arrived.
    const collides = existing.has(recipe.id)
    const id = collides ? crypto.randomUUID() : recipe.id
    if (collides) collided += 1
    await saveRecipe({ ...recipe, id, ...(collides ? { updatedAt: Date.now() } : {}) })
    existing.add(id)
    imported += 1
  }

  return { imported, collided }
}
