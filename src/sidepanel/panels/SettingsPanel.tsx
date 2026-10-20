import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'

export function SettingsPanel() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-[22px] font-bold tracking-tight">Settings</h2>

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

      <p className="text-xs text-muted-foreground">
        Model configuration — base URL, API key, model name, temperature, max tokens, context
        window — arrives in Batch 3.
      </p>
    </div>
  )
}
