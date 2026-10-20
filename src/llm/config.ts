import { z } from 'zod'

import { db } from '@/memory/db'

import type { ProviderId, StreamConfig } from './types'

export const ModelConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'gemini']),
  baseUrl: z.string().min(1),
  apiKey: z.string(),
  modelName: z.string().min(1),
  smallModelName: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1).max(1_000_000),
  contextWindow: z.number().int().min(512),
})

export type ModelConfig = z.infer<typeof ModelConfigSchema>

/** One-click endpoint fillers for the Settings tab. */
export const PROVIDER_PRESETS: Array<{
  label: string
  provider: ProviderId
  baseUrl: string
  modelName: string
  smallModelName: string
}> = [
  {
    label: 'DashScope (Qwen)',
    provider: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    modelName: 'qwen3-max',
    smallModelName: 'qwen3-8b',
  },
  {
    label: 'OpenRouter',
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelName: 'qwen/qwen3-max',
    smallModelName: 'qwen/qwen3-8b',
  },
  {
    label: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4o',
    smallModelName: 'gpt-4o-mini',
  },
  {
    label: 'Ollama (local)',
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    modelName: 'qwen3:8b',
    smallModelName: 'qwen3:4b',
  },
  {
    label: 'vLLM (local)',
    provider: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    modelName: 'qwen3-8b',
    smallModelName: 'qwen3-8b',
  },
  {
    label: 'Anthropic',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    modelName: 'claude-sonnet-4-5',
    smallModelName: 'claude-haiku-4-5',
  },
  {
    label: 'Gemini',
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelName: 'gemini-2.5-pro',
    smallModelName: 'gemini-2.5-flash',
  },
]

function envString(name: string): string | undefined {
  const value = import.meta.env?.[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function envNumber(name: string): number | undefined {
  const value = import.meta.env?.[name]
  if (typeof value !== 'string' || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Build-time defaults from .env; runtime edits in Settings override these. */
export function defaultsFromEnv(): ModelConfig {
  const raw = {
    provider: 'openai' as ProviderId,
    baseUrl: envString('VITE_LLM_BASE_URL') ?? PROVIDER_PRESETS[0]!.baseUrl,
    apiKey: envString('VITE_LLM_API_KEY') ?? '',
    modelName: envString('VITE_LLM_MODEL') ?? PROVIDER_PRESETS[0]!.modelName,
    smallModelName: envString('VITE_LLM_SMALL_MODEL') ?? PROVIDER_PRESETS[0]!.smallModelName,
    temperature: envNumber('VITE_LLM_TEMPERATURE') ?? 0.2,
    maxTokens: envNumber('VITE_LLM_MAX_TOKENS') ?? 4096,
    contextWindow: envNumber('VITE_LLM_CONTEXT_WINDOW') ?? 131072,
  }
  const parsed = ModelConfigSchema.safeParse(raw)
  return parsed.success ? parsed.data : { ...raw, baseUrl: PROVIDER_PRESETS[0]!.baseUrl }
}

const CONFIG_KEY = 'model-config'

export async function loadModelConfig(): Promise<ModelConfig> {
  const row = await db.settings.get(CONFIG_KEY)
  if (row) {
    const parsed = ModelConfigSchema.safeParse(row.value)
    if (parsed.success) return parsed.data
  }
  return defaultsFromEnv()
}

export async function saveModelConfig(config: ModelConfig): Promise<void> {
  const validated = ModelConfigSchema.parse(config)
  await db.settings.put({ key: CONFIG_KEY, value: validated })
}

/** Model router (spec §12): cheap model for classification/extraction/scoring. */
export function configForKind(config: ModelConfig, kind: 'big' | 'small'): ModelConfig {
  return kind === 'small' ? { ...config, modelName: config.smallModelName } : config
}

export function toStreamConfig(config: ModelConfig): StreamConfig {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelName: config.modelName,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  }
}
