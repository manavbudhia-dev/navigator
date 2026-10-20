import { useState } from 'react'
import { Compass, Moon, Sun } from 'lucide-react'

import { AgentPanel } from './panels/AgentPanel'
import { PlaceholderPanel } from './panels/PlaceholderPanel'
import { cn } from '@/lib/utils'

const TABS = ['Agent', 'Research', 'Tabs', 'Profiles', 'History', 'Settings'] as const

type TabId = (typeof TABS)[number]

const COMING_IN: Record<Exclude<TabId, 'Agent'>, string> = {
  Research: 'Batch 8',
  Tabs: 'Batch 9',
  Profiles: 'Batch 7',
  History: 'Batch 10',
  Settings: 'Batch 3',
}

export default function App() {
  const [tab, setTab] = useState<TabId>('Agent')
  const [dark, setDark] = useState(true)

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Compass className="size-4 text-primary" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Navigator</span>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b px-2 py-1.5" aria-label="Sections">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
              tab === id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {id}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto">
        {tab === 'Agent' ? (
          <AgentPanel />
        ) : (
          <PlaceholderPanel title={tab} arriving={COMING_IN[tab]} />
        )}
      </main>
    </div>
  )
}
