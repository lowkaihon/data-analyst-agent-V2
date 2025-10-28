"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Loader2, Copy, Pin, ChevronDown, ChevronUp } from "lucide-react"
import type { Run } from "@/lib/types"

interface SQLTabProps {
  datasetId: string
  refreshTrigger?: number
}

export function SQLTab({ datasetId, refreshTrigger }: SQLTabProps) {
  const [runs, setRuns] = useState<Run[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function fetchRuns() {
      try {
        const response = await fetch(`/api/runs?datasetId=${datasetId}&type=sql`)
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || "Failed to fetch SQL history")
        }

        setRuns(result.runs)
        setTotalCount(result.totalCount || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred")
      } finally {
        setLoading(false)
      }
    }

    fetchRuns()
  }, [datasetId, refreshTrigger])

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

  const toggleResultsExpanded = (runId: string) => {
    setExpandedResults((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(runId)) {
        newSet.delete(runId)
      } else {
        newSet.add(runId)
      }
      return newSet
    })
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
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">SQL Query History</h3>
          <p className="text-sm text-muted-foreground">{runs.length} queries executed</p>
        </div>

        {runs.length === 0 ? (
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-muted-foreground">No SQL queries yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pb-4">
            {runs.map((run, index) => {
              // Calculate query number: oldest = 1, newest = totalCount
              const queryNumber = totalCount - index
              return (
                <Card key={run.id} className="gap-0">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">Query #{queryNumber}</span>
                        <Badge variant={run.status === "success" ? "default" : "destructive"}>{run.status}</Badge>
                      </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleCopy(run.sql || "")}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleTogglePin(run.id, run.pinned)}>
                        {run.pinned ? (
                          <Pin className="h-4 w-4 fill-current text-primary" />
                        ) : (
                          <Pin className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs font-mono">{run.sql}</pre>
                  {run.insight && (
                    <p className="mt-2 text-sm text-muted-foreground italic">
                      {run.insight}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{run.rows} rows</span>
                    <span>{run.duration_ms}ms</span>
                    <span>{new Date(run.time_iso).toLocaleString()}</span>
                  </div>
                  {run.error && <p className="mt-2 text-xs text-destructive">{run.error}</p>}

                  {run.status === "success" && run.sample && Array.isArray(run.sample) && run.sample.length > 0 && (
                    <Collapsible
                      open={expandedResults.has(run.id)}
                      onOpenChange={() => toggleResultsExpanded(run.id)}
                      className="mt-3"
                    >
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full">
                          {expandedResults.has(run.id) ? (
                            <ChevronUp className="mr-2 h-4 w-4" />
                          ) : (
                            <ChevronDown className="mr-2 h-4 w-4" />
                          )}
                          {expandedResults.has(run.id) ? "Hide" : "View"} Results ({run.rows} rows)
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="rounded border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {(() => {
                                  // Use stored column order if available, otherwise fallback to Object.keys
                                  const columns = run.columns && run.columns.length > 0
                                    ? run.columns
                                    : Object.keys(run.sample[0])
                                  return columns.map((column) => (
                                    <TableHead key={column}>{column}</TableHead>
                                  ))
                                })()}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(() => {
                                // Use stored column order if available, otherwise fallback to Object.keys
                                const columns = run.columns && run.columns.length > 0
                                  ? run.columns
                                  : Object.keys(run.sample[0])
                                return run.sample.map((row: any, rowIndex: number) => (
                                  <TableRow key={rowIndex}>
                                    {columns.map((column) => {
                                      const value = row[column]
                                      return (
                                        <TableCell key={column}>
                                          {value === null || value === undefined
                                            ? <span className="text-muted-foreground italic">null</span>
                                            : typeof value === "object"
                                              ? JSON.stringify(value)
                                              : String(value)}
                                        </TableCell>
                                      )
                                    })}
                                  </TableRow>
                                ))
                              })()}
                            </TableBody>
                          </Table>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CardContent>
              </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
