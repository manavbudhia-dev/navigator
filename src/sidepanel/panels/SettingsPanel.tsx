import { useEffect, useState } from 'react'
import { CheckCircle2, Coins, Loader2, Moon, PlugZap, Sun, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import { nextTheme, type Theme } from '@/lib/theme'
import { clearPricing, loadPricing, savePricing } from '@/memory/cost'
import { EMPTY_ALLOWLIST_HINT, EMPTY_BLOCKLIST_HINT } from '@/safety/siteRules'
import {
  PROVIDER_PRESETS,
  loadModelConfig,
  saveModelConfig,
  type ModelConfig,
} from '@/llm/config'
import { complete } from '@/llm'

import { SiteListCard } from '../components/SiteListCard'

import type { ProviderId } from '@/llm/types'

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; detail: string }
  | { status: 'error'; message: string }

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI-compatible (Qwen, OpenRouter, Ollama, vLLM)' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini' },
]

/** How long the connection test waits before it calls the endpoint dead. */
const CONNECT_TEST_TIMEOUT_MS = 15_000

/**
 * The theme lives in App, not here: the command palette changes it too, and it
 * is persisted, so two owners would disagree the moment the panel reopens.
 */
export function SettingsPanel({ theme, onTheme }: { theme: Theme; onTheme: (theme: Theme) => void }) {
  const [config, setConfig] = useState<ModelConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [price, setPrice] = useState({ symbol: '', input: '', output: '' })
  const [hasPrice, setHasPrice] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoadFailed(false)
    void loadModelConfig()
      .then((value) => {
        if (alive) setConfig(value)
      })
      .catch(() => {
        // Without this the panel would sit on "Loading settings…" forever,
        // because a rejected read never calls setConfig.
        if (alive) setLoadFailed(true)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  useEffect(() => {
    void loadPricing()
      .catch(() => null)
      .then((stored) => {
        if (stored === null) return
        setPrice({
          symbol: stored.symbol,
          input: String(stored.inputPerMillion),
          output: String(stored.outputPerMillion),
        })
        setHasPrice(true)
      })
  }, [])

  const dark = theme === 'dark'

  function toggleTheme() {
    onTheme(nextTheme(theme))
  }

  function update<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
    setTest({ status: 'idle' })
  }

  function applyPreset(index: number) {
    const preset = PROVIDER_PRESETS[index]
    if (!preset) return
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            provider: preset.provider,
            baseUrl: preset.baseUrl,
            modelName: preset.modelName,
            smallModelName: preset.smallModelName,
          }
        : prev,
    )
    setSaved(false)
    setTest({ status: 'idle' })
  }

  async function handleSave() {
    if (!config) return
    try {
      await saveModelConfig(config)
      setSaved(true)
    } catch (error) {
      setTest({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not save configuration.',
      })
    }
  }

  async function handleTest() {
    if (!config) return
    setTest({ status: 'testing' })
    // A hung provider would otherwise leave the button spinning for the rest
    // of the panel's life, with no way to tell a slow endpoint from a dead one.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CONNECT_TEST_TIMEOUT_MS)
    try {
      const result = await complete(
        {
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          maxTokens: 8,
        },
        config,
        { kind: 'small', signal: controller.signal },
      )
      const reply = (result.message.content ?? '').trim()
      setTest({
        status: 'ok',
        detail: `${config.smallModelName} replied “${reply.slice(0, 40) || '(empty)'}” · ${result.usage.promptTokens + result.usage.completionTokens} tokens`,
      })
    } catch (error) {
      setTest({
        status: 'error',
        message: controller.signal.aborted
          ? `No answer within ${CONNECT_TEST_TIMEOUT_MS / 1000} seconds. Check the base URL, the key and the model name.`
          : error instanceof Error
            ? error.message
            : 'Connection failed.',
      })
    } finally {
      clearTimeout(timer)
    }
  }

  function updatePrice(key: 'symbol' | 'input' | 'output', value: string) {
    setPrice((prev) => ({ ...prev, [key]: value }))
    setPriceError(null)
  }

  async function handleSavePrice() {
    const symbol = price.symbol.trim()
    const input = Number(price.input)
    const output = Number(price.output)
    if (symbol === '' || symbol.length > 3) {
      setPriceError('A currency symbol is 1 to 3 characters, like $ or ₹.')
      return
    }
    if (
      price.input.trim() === '' ||
      price.output.trim() === '' ||
      !Number.isFinite(input) ||
      !Number.isFinite(output) ||
      input < 0 ||
      output < 0
    ) {
      setPriceError('Enter both prices as numbers of 0 or more.')
      return
    }
    try {
      await savePricing({ symbol, inputPerMillion: input, outputPerMillion: output })
      setPriceError(null)
      setHasPrice(true)
    } catch (error) {
      setPriceError(error instanceof Error ? error.message : 'Could not save the price.')
    }
  }

  async function handleClearPrice() {
    try {
      await clearPricing()
    } catch (error) {
      setPriceError(error instanceof Error ? error.message : 'Could not clear the price.')
      return
    }
    setPrice({ symbol: '', input: '', output: '' })
    setHasPrice(false)
    setPriceError(null)
  }

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        {loadFailed ? (
          <>
            <XCircle className="size-4 text-destructive" aria-hidden />
            <p className="text-center">Navigator could not read its settings from this browser.</p>
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading settings…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-[22px] font-bold tracking-tight">Settings</h2>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <div>
          <p className="text-sm font-semibold">Model provider</p>
          <p className="text-xs text-muted-foreground">
            Keys stay in this browser — they are never synced anywhere.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">API style</span>
          <select
            value={config.provider}
            onChange={(event) => update('provider', event.target.value as ProviderId)}
            className="h-9 rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_PRESETS.map((preset, index) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(index)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted',
                config.baseUrl === preset.baseUrl &&
                  config.modelName === preset.modelName &&
                  'border-primary bg-primary/10 text-primary',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <Field label="Base URL">
          <input
            type="url"
            value={config.baseUrl}
            onChange={(event) => update('baseUrl', event.target.value)}
            placeholder="https://…/v1"
            className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>

        <Field label="API key">
          <input
            type="password"
            value={config.apiKey}
            onChange={(event) => update('apiKey', event.target.value)}
            placeholder="sk-… (leave empty for local servers)"
            autoComplete="off"
            className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Model (agent)">
            <input
              value={config.modelName}
              onChange={(event) => update('modelName', event.target.value)}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Small model (fast tasks)">
            <input
              value={config.smallModelName}
              onChange={(event) => update('smallModelName', event.target.value)}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Temperature">
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={config.temperature}
              onChange={(event) => update('temperature', Number(event.target.value))}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Max tokens">
            <input
              type="number"
              min={1}
              step={256}
              value={config.maxTokens}
              onChange={(event) => update('maxTokens', Number(event.target.value))}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Context window">
            <input
              type="number"
              min={512}
              step={1024}
              value={config.contextWindow}
              onChange={(event) => update('contextWindow', Number(event.target.value))}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {saved ? <CheckCircle2 className="size-4" aria-hidden /> : null}
            {saved ? 'Saved' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={test.status === 'testing'}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {test.status === 'testing' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="size-4" aria-hidden />
            )}
            Test connection
          </button>
        </div>

        {test.status === 'ok' ? (
          <p className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
            {test.detail}
          </p>
        ) : null}
        {test.status === 'error' ? (
          <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
            <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
            {test.message}
          </p>
        ) : null}
      </section>

      <SiteListCard
        list="allow"
        title="Auto mode sites"
        description="Sites Navigator may write to on its own in Auto mode. A subdomain is covered by the site above it, and a task keeps the list it started with."
        inputLabel="Site to allow"
        emptyHint={EMPTY_ALLOWLIST_HINT}
        removePrefix="Stop allowing"
        clearLabel="Stop allowing every site"
      />

      <SiteListCard
        list="block"
        title="Blocked sites"
        description="Sites Navigator must not read or touch at all, in any mode. A research run skips them too, and only you can take a site off this list."
        inputLabel="Site to block"
        emptyHint={EMPTY_BLOCKLIST_HINT}
        removePrefix="Stop blocking"
        clearLabel="Stop blocking every site"
      />

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-3" data-pricing>
        <div className="flex items-start gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Coins className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Cost meter</p>
            <p className="text-xs text-muted-foreground">
              Your model&apos;s price per million tokens. Without it the panel counts tokens and
              never guesses money.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Symbol">
            <input
              value={price.symbol}
              onChange={(event) => updatePrice('symbol', event.target.value)}
              placeholder="$"
              maxLength={3}
              aria-label="Currency symbol"
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Input / million">
            <input
              type="number"
              min={0}
              step={0.1}
              value={price.input}
              onChange={(event) => updatePrice('input', event.target.value)}
              placeholder="0"
              aria-label="Price per million input tokens"
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Output / million">
            <input
              type="number"
              min={0}
              step={0.1}
              value={price.output}
              onChange={(event) => updatePrice('output', event.target.value)}
              placeholder="0"
              aria-label="Price per million output tokens"
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSavePrice()}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {hasPrice ? <CheckCircle2 className="size-4" aria-hidden /> : null}
            {hasPrice ? 'Price saved' : 'Save price'}
          </button>
          {hasPrice ? (
            <button
              type="button"
              onClick={() => void handleClearPrice()}
              className="h-9 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              Stop estimating
            </button>
          ) : null}
        </div>

        {priceError ? (
          <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
            <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
            {priceError}
          </p>
        ) : null}
      </section>

      <section className="flex items-center gap-3 rounded-xl border bg-card p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          {dark ? (
            <Moon className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden />
          ) : (
            <Sun className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Dark mode</p>
          <p className="text-xs text-muted-foreground">Switch the panel between light and dark.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dark}
          aria-label="Dark mode"
          onClick={toggleTheme}
          className={cn(
            'h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors',
            dark ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'block size-5 rounded-full bg-white shadow transition-transform',
              dark && 'translate-x-5',
            )}
          />
        </button>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
