import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

export type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error'

const STYLES: Record<ConnectionStatus, string> = {
  idle: 'bg-muted text-muted-foreground',
  checking: 'bg-muted text-muted-foreground',
  connected: 'bg-green-50 text-green-700',
  error: 'bg-red-50 text-red-600',
}

const LABELS: Record<ConnectionStatus, string> = {
  idle: 'Unknown',
  checking: 'Checking…',
  connected: 'Connected',
  error: 'Not connected',
}

export function StatusPill({ status, className }: { status: ConnectionStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
        STYLES[status],
        className,
      )}
    >
      {status === 'connected' ? (
        <CircleCheck className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden />
      ) : status === 'error' ? (
        <CircleX className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden />
      ) : status === 'checking' ? (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
      ) : null}
      {LABELS[status]}
    </span>
  )
}
