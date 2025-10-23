"use client"

import { useEffect, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, Copy, Pin, PinOff } from "lucide-react"
import type { Run } from "@/lib/types"

interface SQLTabProps {
  datasetId: string
}

export function SQLTab({ datasetId }: SQLTabProps) {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchRuns() {
      try {
        const response = await fetch(`/api/runs?datasetId=${datasetId}&type=sql`)
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || "Failed to fetch SQL history")
        }

        setRuns(result.runs)
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred")
      } finally {
        setLoading(false)
      }
    }

    fetchRuns()
  }, [datasetId])

  const handleCopy = (sql: string) => {
    navigator.clipboard.writeText(sql)
  }

  const handleTogglePin = async (runId: string, currentPinned: boolean) => {
    try {
      await fetch(`/api/runs/${runId}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !currentPinned }),
      })

      setRuns((prev) => prev.map((run) => (run.id === runId ? { ...run, pinned: !currentPinned } : run)))
    } catch (err) {
      console.error("Failed to toggle pin:", err)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">SQL Query History</h3>
          <p className="text-sm text-muted-foreground">{runs.length} queries executed</p>
        </div>

        {runs.length === 0 ? (
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-muted-foreground">No SQL queries yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {runs.map((run) => (
              <Card key={run.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={run.status === "success" ? "default" : "destructive"}>{run.status}</Badge>
                      {run.pinned && <Pin className="h-3 w-3 fill-current text-primary" />}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleCopy(run.sql || "")}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleTogglePin(run.id, run.pinned)}>
                        {run.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs font-mono">{run.sql}</pre>
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{run.rows} rows</span>
                    <span>{run.duration_ms}ms</span>
                    <span>{new Date(run.time_iso).toLocaleString()}</span>
                  </div>
                  {run.error && <p className="mt-2 text-xs text-destructive">{run.error}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
