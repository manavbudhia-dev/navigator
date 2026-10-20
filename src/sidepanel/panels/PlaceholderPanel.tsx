export function PlaceholderPanel({ title, arriving }: { title: string; arriving: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="max-w-56 text-xs text-muted-foreground">
        Not built yet — arrives in {arriving}.
      </p>
    </div>
  )
}
