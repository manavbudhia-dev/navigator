import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Clock, Copy, Search, Settings, Sparkle, UserRound, X } from 'lucide-react'

import { AgentPanel } from './panels/AgentPanel'
import { HistoryPanel } from './panels/HistoryPanel'
import { ProfilesPanel } from './panels/ProfilesPanel'
import { ResearchPanel } from './panels/ResearchPanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { TabsPanel } from './panels/TabsPanel'
import { CommandPalette } from './components/CommandPalette'
import { buildCommands } from './commands'
import { useTaskBridge } from './useTaskBridge'
import { useVault } from './useVault'
import { isPaletteShortcut, PALETTE_SHORTCUT_LABEL } from '@/commands/model'
import { saveTextFile, stampedFilename } from '@/lib/download'
import { buildAuditExport } from '@/memory/export'
import { applyTheme, nextTheme, preferredTheme, type Theme } from '@/lib/theme'
import { loadTheme, saveTheme } from '@/lib/themeStore'
import { inExtension } from '@/lib/extension'
import { cn } from '@/lib/utils'
import { AGENT_MODES, MODE_LABELS, type AgentMode } from '@/types/agent'
import { TAB_VIEWS, VIEWS, type ViewId } from './views'
import { isPanelCommandMessage, type BackgroundMessage, type BackgroundResponse } from '@/types/messages'

/**
 * The panel shell. It owns what more than one surface needs — the running task,
 * the mode, the goal being typed, the theme and the command palette — because
 * the palette has to be able to change all of them from anywhere (spec §10).
 */
export default function App() {
  const [view, setView] = useState<ViewId>('agent')
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<AgentMode>('copilot')
  const [theme, setTheme] = useState<Theme>(() =>
    preferredTheme(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false),
  )
  const [overlayOn, setOverlayOn] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const goalRef = useRef<HTMLTextAreaElement>(null)
  const vault = useVault()
  const task = useTaskBridge()

  // Read the stored theme once; after that this component is the only writer.
  useEffect(() => {
    void loadTheme().then(setTheme)
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const changeTheme = useCallback((next: Theme): void => {
    setTheme(next)
    void saveTheme(next)
  }, [])

  const setOverlay = useCallback(async (visible: boolean): Promise<void> => {
    if (!inExtension) return
    setOverlayOn(visible)
    const message: BackgroundMessage = { kind: 'set-overlay', visible }
    try {
      const response = (await chrome.runtime.sendMessage(message)) as BackgroundResponse
      if (!response.ok) setOverlayOn(!visible)
    } catch {
      setOverlayOn(!visible)
    }
  }, [])

  const startTask = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (trimmed === '' || task.running) return
      setGoal(trimmed)
      setView('agent')
      void task.start(trimmed, mode)
    },
    [mode, task],
  )

  const exportAuditLog = useCallback((): void => {
    void (async () => {
      try {
        await saveTextFile(
          stampedFilename('navigator-audit', 'json'),
          'application/json',
          await buildAuditExport(),
        )
        setNotice('Audit log saved to your Downloads folder.')
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }, [])

  const commands = useMemo(
    () =>
      buildCommands({
        go: setView,
        goal,
        mode,
        running: task.running,
        inChrome: inExtension,
        startWrittenTask: () => startTask(goal),
        stopTask: () => void task.stop(),
        focusTaskBox: () => goalRef.current?.focus(),
        setMode,
        theme,
        toggleTheme: () => changeTheme(nextTheme(theme)),
        overlayOn,
        toggleOverlay: () => void setOverlay(!overlayOn),
        exportAuditLog,
      }),
    [changeTheme, exportAuditLog, goal, mode, overlayOn, setOverlay, startTask, task, theme],
  )

  // The global shortcut arrives from the worker — see `chrome.commands` in the manifest.
  useEffect(() => {
    if (!inExtension) return
    const listener = (message: unknown): undefined => {
      if (isPanelCommandMessage(message)) setPaletteOpen(true)
      return undefined
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // Ctrl+Shift+K anywhere in the panel; Alt+1…6 jumps between sections; Esc is
  // the kill switch (spec §9) when no dialog is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isPaletteShortcut(event)) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-6]$/.test(event.key)) {
        const target = VIEWS[Number(event.key) - 1]
        if (target !== undefined) {
          event.preventDefault()
          setView(target.id)
        }
        return
      }
      if (event.key === 'Escape' && !paletteOpen && task.running) {
        event.preventDefault()
        void task.stop()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, task])

  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

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
            onClick={() => setPaletteOpen(true)}
            aria-label={`Open the command palette (${PALETTE_SHORTCUT_LABEL})`}
            title={`Command palette · ${PALETTE_SHORTCUT_LABEL}`}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Search className="size-[18px]" strokeWidth={1.8} />
          </button>
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
        {TAB_VIEWS.map((tab) => {
          const Icon = ICONS[tab.id]
          const selected = view === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              aria-current={selected ? 'page' : undefined}
              title={`${tab.label} · Alt+${VIEWS.findIndex((entry) => entry.id === tab.id) + 1}`}
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
          <AgentPanel
            onOpenHistory={() => setView('history')}
            task={task}
            mode={mode}
            onMode={setMode}
            goal={goal}
            onGoal={setGoal}
            goalRef={goalRef}
            overlayOn={overlayOn}
            onOverlay={(visible) => void setOverlay(visible)}
          />
        ) : view === 'history' ? (
          <HistoryPanel />
        ) : view === 'profiles' ? (
          <ProfilesPanel vault={vault} />
        ) : view === 'research' ? (
          <ResearchPanel />
        ) : view === 'tabs' ? (
          <TabsPanel />
        ) : (
          <SettingsPanel theme={theme} onTheme={changeTheme} />
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
        onStartTask={startTask}
        shortcutLabel={PALETTE_SHORTCUT_LABEL}
      />

      {/* One live region for the whole panel: what the palette or a button just did. */}
      <p className="sr-only" role="status" aria-live="polite">
        {notice ?? ''}
      </p>
      {notice === null ? null : (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <p className="max-w-full truncate rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow-lg">
            {notice}
          </p>
        </div>
      )}
    </div>
  )
}

const ICONS = {
  agent: Bot,
  research: Search,
  tabs: Copy,
  profiles: UserRound,
  history: Clock,
  settings: Settings,
} as const
