"use client"

import { useEffect, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Pin, AlertTriangle } from "lucide-react"
import type { Run } from "@/lib/types"
import { VegaLiteChart } from "@/components/vega-lite-chart"
import { validateVegaSpec } from "@/lib/vega-validator"

interface ChartsTabProps {
  datasetId: string
  refreshTrigger?: number
}

export function ChartsTab({ datasetId, refreshTrigger }: ChartsTabProps) {
  const [charts, setCharts] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
            {charts.map((chart) => {
              // Validate spec for security before rendering
              const validation = chart.chart_spec ? validateVegaSpec(chart.chart_spec) : { isValid: false, error: "No spec available" }

              return (
                <Card key={chart.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{chart.insight || "Visualization"}</CardTitle>
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
