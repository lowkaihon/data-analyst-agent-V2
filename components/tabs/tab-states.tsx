import { Loader2 } from "lucide-react"

export function TabLoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export function TabErrorState({ error }: { error: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-destructive">{error}</p>
    </div>
  )
}
