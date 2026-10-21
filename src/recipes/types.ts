import { z } from 'zod'

import { ELEMENT_ROLES } from '@/types/pageState'

/**
 * Recipes (spec §11): a successful run, saved as an ordered, parameterised
 * workflow that can be replayed without a model — until a step stops working,
 * and then the model is asked about that one step.
 *
 * Every field is required and `null` is used for "absent". Imported JSON is
 * untrusted input, and a schema that distinguishes missing from null is one
 * less way for a hand-edited file to slip through.
 */

const ElementRoleSchema = z.enum(ELEMENT_ROLES)

const ElementSelectorSchema = z.object({
  css: z.string(),
  xpath: z.string(),
  textAnchor: z.string(),
  bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  tag: z.string(),
  role: ElementRoleSchema,
  frameUrl: z.string().nullable(),
})

/** The control an action touched, as recorded from the page. */
export const ElementTargetSchema = z.object({
  selector: ElementSelectorSchema,
  label: z.string(),
  role: ElementRoleSchema,
  // A hand-written workflow file does not have to state it.
  inputType: z.string().nullable().default(null),
})

/** One replayable action: a tool, its arguments, and where it pointed. */
export const RecipeStepSchema = z.object({
  tool: z.string().min(1),
  /** Element indices are page-state specific and never recorded — the target replaces them. */
  args: z.record(z.string(), z.unknown()),
  note: z.string(),
  target: ElementTargetSchema.nullable(),
})

export const RecipeParamSchema = z.object({
  /** `{{job_title}}` in a step's text refers to this name. */
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/, 'Parameter names are lower-case words with underscores'),
  label: z.string(),
  /** The value the run actually used, so a re-run can default to it. */
  sample: z.string(),
})

export const RecipeScheduleSchema = z.object({
  frequency: z.enum(['daily', 'weekly']),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  /** Ignored for daily runs. 0 = Sunday, matching `Date.getDay()`. */
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
})

export const RecipeRunSchema = z.object({
  at: z.number(),
  ok: z.boolean(),
  detail: z.string(),
  /** Steps that had to be re-decided by the model instead of the recording. */
  healed: z.number().int().min(0),
})

export const RecipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  goal: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  steps: z.array(RecipeStepSchema).min(1).max(60),
  params: z.array(RecipeParamSchema).max(20),
  schedule: RecipeScheduleSchema.nullable(),
  lastRun: RecipeRunSchema.nullable(),
  /** The audit run this was built from, so the library can link back to the evidence. */
  originRunId: z.string().nullable(),
})

export type ElementTarget = z.infer<typeof ElementTargetSchema>
export type RecipeStep = z.infer<typeof RecipeStepSchema>
export type RecipeParam = z.infer<typeof RecipeParamSchema>
export type RecipeSchedule = z.infer<typeof RecipeScheduleSchema>
export type RecipeRun = z.infer<typeof RecipeRunSchema>
export type Recipe = z.infer<typeof RecipeSchema>

/** A workflow file: more than one recipe per export, so a folder can be shared. */
export const RecipeFileSchema = z.object({
  app: z.literal('navigator'),
  kind: z.literal('recipes'),
  version: z.literal(1),
  exportedAt: z.number(),
  recipes: z.array(RecipeSchema).min(1),
})

export type RecipeFile = z.infer<typeof RecipeFileSchema>
