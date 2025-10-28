"use client"

import { useEffect, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Loader2, Pin, AlertTriangle, Copy, ChevronDown, ChevronUp } from "lucide-react"
import type { Run } from "@/lib/types"
import { VegaLiteChart } from "@/components/vega-lite-chart"
import { validateVegaSpec } from "@/lib/vega-validator"

interface ChartsTabProps {
  datasetId: string
  refreshTrigger?: number
}

export function ChartsTab({ datasetId, refreshTrigger }: ChartsTabProps) {
  const [charts, setCharts] = useState<Run[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSQL, setExpandedSQL] = useState<Set<string>>(new Set())
  const [expandedData, setExpandedData] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function fetchCharts() {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch(`/api/runs?datasetId=${datasetId}&type=chart`)
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || "Failed to fetch charts")
        }

        setCharts(result.runs)
        setTotalCount(result.totalCount || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred")
      } finally {
        setLoading(false)
      }
    }

    fetchCharts()
  }, [datasetId, refreshTrigger])

  const handleTogglePin = async (runId: string, currentPinned: boolean) => {
    try {
      await fetch(`/api/runs/${runId}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !currentPinned }),
      })

      setCharts((prev) => prev.map((chart) => (chart.id === runId ? { ...chart, pinned: !currentPinned } : chart)))
    } catch (err) {
      console.error("Failed to toggle pin:", err)
    }
  }

  const toggleSQLExpanded = (chartId: string) => {
    setExpandedSQL((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(chartId)) {
        newSet.delete(chartId)
      } else {
        newSet.add(chartId)
      }
      return newSet
    })
  }

  const toggleDataExpanded = (chartId: string) => {
    setExpandedData((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(chartId)) {
        newSet.delete(chartId)
      } else {
        newSet.add(chartId)
      }
      return newSet
    })
  }

  const handleCopySQL = (sql: string) => {
    navigator.clipboard.writeText(sql)
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
          <h3 className="text-lg font-semibold">Charts Gallery</h3>
          <p className="text-sm text-muted-foreground">{charts.length} visualizations</p>
        </div>

        {charts.length === 0 ? (
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-muted-foreground">No charts yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {charts.map((chart, index) => {
              // Calculate chart number: oldest = 1, newest = totalCount
              const chartNumber = totalCount - index

              // Validate spec for security before rendering
              const validation = chart.chart_spec ? validateVegaSpec(chart.chart_spec) : { isValid: false, error: "No spec available" }

              return (
                <Card key={chart.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-muted-foreground">Chart #{chartNumber}</span>
                        <CardTitle className="text-sm">{chart.insight || "Visualization"}</CardTitle>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleTogglePin(chart.id, chart.pinned)}>
                        {chart.pinned ? (
                          <Pin className="h-4 w-4 fill-current text-primary" />
                        ) : (
                          <Pin className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {validation.isValid && validation.sanitizedSpec ? (
                      <VegaLiteChart spec={validation.sanitizedSpec} className="w-full" />
                    ) : (
                      <div className="flex min-h-[200px] items-center justify-center rounded border border-destructive/50 bg-destructive/10 p-4">
                        <div className="text-center">
                          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
                          <p className="mt-2 text-sm font-medium text-destructive">Invalid Chart Specification</p>
                          <p className="mt-1 text-xs text-muted-foreground">{validation.error}</p>
                        </div>
                      </div>
                    )}

                    {/* SQL Query Section */}
                    {chart.sql && (
                      <Collapsible
                        open={expandedSQL.has(chart.id)}
                        onOpenChange={() => toggleSQLExpanded(chart.id)}
                        className="mt-3"
                      >
                        <CollapsibleTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full">
                            {expandedSQL.has(chart.id) ? (
                              <ChevronUp className="mr-2 h-4 w-4" />
                            ) : (
                              <ChevronDown className="mr-2 h-4 w-4" />
                            )}
                            {expandedSQL.has(chart.id) ? "Hide" : "View"} SQL Query
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2">
                          <div className="relative">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs font-mono">
                              {chart.sql}
                            </pre>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute top-2 right-2"
                              onClick={() => handleCopySQL(chart.sql || "")}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Data Results Section */}
                    {chart.sample && Array.isArray(chart.sample) && chart.sample.length > 0 && (
                      <Collapsible
                        open={expandedData.has(chart.id)}
                        onOpenChange={() => toggleDataExpanded(chart.id)}
                        className="mt-3"
                      >
                        <CollapsibleTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full">
                            {expandedData.has(chart.id) ? (
                              <ChevronUp className="mr-2 h-4 w-4" />
                            ) : (
                              <ChevronDown className="mr-2 h-4 w-4" />
                            )}
                            {expandedData.has(chart.id) ? "Hide" : "View"} Data ({chart.sample.length} rows)
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2">
                          <div className="rounded border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  {(() => {
                                    const columns = chart.columns && chart.columns.length > 0
                                      ? chart.columns
                                      : Object.keys(chart.sample[0])
                                    return columns.map((column) => (
                                      <TableHead key={column}>{column}</TableHead>
                                    ))
                                  })()}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(() => {
                                  const columns = chart.columns && chart.columns.length > 0
                                    ? chart.columns
                                    : Object.keys(chart.sample[0])
                                  return chart.sample.map((row: any, rowIndex: number) => (
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

                    <p className="mt-2 text-xs text-muted-foreground">{new Date(chart.time_iso).toLocaleString()}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
