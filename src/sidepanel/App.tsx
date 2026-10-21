import { useState } from 'react'
import { Bot, Clock, Copy, Search, Settings, Sparkle, UserRound, X } from 'lucide-react'

import { AgentPanel } from './panels/AgentPanel'
import { HistoryPanel } from './panels/HistoryPanel'
import { PlaceholderPanel } from './panels/PlaceholderPanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'research', label: 'Research', icon: Search },
  { id: 'tabs', label: 'Tabs', icon: Copy },
  { id: 'profiles', label: 'Profiles', icon: UserRound },
  { id: 'history', label: 'History', icon: Clock },
] as const

type TabId = (typeof TABS)[number]['id']
type ViewId = TabId | 'settings'

const COMING_IN: Record<Exclude<TabId, 'agent' | 'history'>, string> = {
  research: 'Batch 8',
  tabs: 'Batch 9',
  profiles: 'Batch 7',
}

export default function App() {
  const [view, setView] = useState<ViewId>('agent')

  const activeTab = TABS.find((tab) => tab.id === view)

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Sparkle className="size-6 text-primary" fill="currentColor" strokeWidth={0} aria-hidden />
        <h1 className="text-[17px] font-bold tracking-tight">Navigator</h1>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-primary">
          BETA
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setView('settings')}
            aria-label="Settings"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings className="size-[18px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            aria-label="Close panel"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-[18px]" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <nav className="grid grid-cols-5 border-b px-1" aria-label="Sections">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const selected = view === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                '-mb-px flex flex-col items-center gap-1 border-b-2 pb-2.5 pt-2 text-[11px] font-medium transition-colors',
                selected
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-5" strokeWidth={1.8} aria-hidden />
              {tab.label}
            </button>
          )
        })}
      </nav>

      <main className="flex-1 overflow-y-auto">
        {view === 'agent' ? (
          <AgentPanel onOpenHistory={() => setView('history')} />
        ) : view === 'history' ? (
          <HistoryPanel />
        ) : view === 'settings' ? (
          <SettingsPanel />
        ) : (
          <PlaceholderPanel title={activeTab?.label ?? ''} arriving={COMING_IN[view]} />
        )}
      </main>
    </div>
  )
}
