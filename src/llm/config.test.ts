import { describe, expect, it } from 'vitest'

import { ModelConfigSchema, configForKind, defaultsFromEnv, toStreamConfig } from './config'

const valid = {
  provider: 'openai',
  baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-test',
  modelName: 'qwen3-max',
  smallModelName: 'qwen3-8b',
  temperature: 0.2,
  maxTokens: 4096,
  contextWindow: 131072,
}

describe('ModelConfigSchema', () => {
  it('accepts a valid config', () => {
    expect(ModelConfigSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects unknown providers, empty URLs and out-of-range numbers', () => {
    expect(ModelConfigSchema.safeParse({ ...valid, provider: 'mistral' }).success).toBe(false)
    expect(ModelConfigSchema.safeParse({ ...valid, baseUrl: '' }).success).toBe(false)
    expect(ModelConfigSchema.safeParse({ ...valid, temperature: 3 }).success).toBe(false)
    expect(ModelConfigSchema.safeParse({ ...valid, maxTokens: 0 }).success).toBe(false)
    expect(ModelConfigSchema.safeParse({ ...valid, contextWindow: 10 }).success).toBe(false)
    expect(ModelConfigSchema.safeParse({ ...valid, maxTokens: 1.5 }).success).toBe(false)
  })

  it('allows an empty apiKey for local servers', () => {
    expect(ModelConfigSchema.safeParse({ ...valid, apiKey: '' }).success).toBe(true)
  })
})

describe('defaultsFromEnv', () => {
  it('returns a schema-valid config when no env vars are set', () => {
    const config = defaultsFromEnv()
    expect(ModelConfigSchema.safeParse(config).success).toBe(true)
    expect(config.provider).toBe('openai')
    expect(config.baseUrl).toContain('http')
    expect(config.modelName.length).toBeGreaterThan(0)
  })
})

describe('configForKind', () => {
  it('swaps in the small model for small tasks only', () => {
    const config = ModelConfigSchema.parse(valid)
    expect(configForKind(config, 'small').modelName).toBe('qwen3-8b')
    expect(configForKind(config, 'big').modelName).toBe('qwen3-max')
    expect(config.modelName).toBe('qwen3-max')
  })
})

describe('toStreamConfig', () => {
  it('projects only the fields the providers need', () => {
    const streamConfig = toStreamConfig(ModelConfigSchema.parse(valid))
    expect(streamConfig).toEqual({
      baseUrl: valid.baseUrl,
      apiKey: 'sk-test',
      modelName: 'qwen3-max',
      temperature: 0.2,
      maxTokens: 4096,
    })
  })
})
