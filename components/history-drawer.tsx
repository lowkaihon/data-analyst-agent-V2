"use client"

import { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { History, Search, Copy, Pin, PinOff } from "lucide-react"
import { VegaLiteChart } from "@/components/vega-lite-chart"
import type { Run } from "@/lib/types"

interface HistoryDrawerProps {
  datasetId: string
}

export function HistoryDrawer({ datasetId }: HistoryDrawerProps) {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [filteredRuns, setFilteredRuns] = useState<Run[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedRun, setSelectedRun] = useState<Run | null>(null)

  useEffect(() => {
    if (open) {
      fetchRuns()
    }
  }, [open, datasetId])

  useEffect(() => {
    filterRuns()
  }, [runs, searchQuery, typeFilter, statusFilter])

  const fetchRuns = async () => {
    try {
      const response = await fetch(`/api/runs?datasetId=${datasetId}`)
      const result = await response.json()
      setRuns(result.runs || [])
    } catch (err) {
      console.error("Failed to fetch runs:", err)
    }
  }

  const filterRuns = () => {
    let filtered = runs

    if (searchQuery) {
      filtered = filtered.filter(
        (run) =>
          run.sql?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          run.insight?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter((run) => run.type === typeFilter)
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((run) => run.status === statusFilter)
    }

    setFilteredRuns(filtered)
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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <History className="h-4 w-4" />
          History
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Artifact History</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          {/* Search and Filters */}
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search artifacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All Types</option>
                <option value="sql">SQL</option>
                <option value="chart">Chart</option>
                <option value="validate">Validate</option>
                <option value="summarize">Summarize</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          {/* Results */}
          <ScrollArea className="h-[calc(100vh-200px)]">
            {selectedRun ? (
              <div className="flex flex-col gap-4">
                <Button variant="ghost" onClick={() => setSelectedRun(null)} className="w-fit">
                  ← Back to list
                </Button>
                <RunDetails run={selectedRun} onTogglePin={handleTogglePin} onCopy={handleCopy} />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredRuns.length === 0 ? (
                  <div className="flex h-64 items-center justify-center">
                    <p className="text-sm text-muted-foreground">No artifacts found</p>
                  </div>
                ) : (
                  filteredRuns.map((run) => (
                    <Card key={run.id} className="cursor-pointer hover:bg-accent" onClick={() => setSelectedRun(run)}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{run.type}</Badge>
                            <Badge variant={run.status === "success" ? "default" : "destructive"}>{run.status}</Badge>
                            {run.pinned && <Pin className="h-3 w-3 fill-current text-primary" />}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(run.time_iso).toLocaleString()}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {run.sql && <p className="truncate text-sm font-mono">{run.sql}</p>}
                        {run.insight && <p className="text-sm text-muted-foreground">{run.insight}</p>}
                        {run.type === "sql" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {run.rows} rows • {run.duration_ms}ms
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function RunDetails({
  run,
  onTogglePin,
  onCopy,
}: {
  run: Run
  onTogglePin: (id: string, pinned: boolean) => void
  onCopy: (text: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{run.type}</Badge>
          <Badge variant={run.status === "success" ? "default" : "destructive"}>{run.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => onTogglePin(run.id, run.pinned)}>
            {run.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          {run.sql && (
            <Button variant="ghost" size="icon" onClick={() => onCopy(run.sql || "")}>
              <Copy className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {run.sql && <TabsTrigger value="sql">SQL</TabsTrigger>}
          {run.chart_spec && <TabsTrigger value="chart">Chart</TabsTrigger>}
          {run.sample && <TabsTrigger value="data">Data</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold">Time</h4>
            <p className="text-sm text-muted-foreground">{new Date(run.time_iso).toLocaleString()}</p>
          </div>
          {run.insight && (
            <div>
              <h4 className="text-sm font-semibold">Insight</h4>
              <p className="text-sm text-muted-foreground">{run.insight}</p>
            </div>
          )}
          {run.type === "sql" && (
            <div>
              <h4 className="text-sm font-semibold">Results</h4>
              <p className="text-sm text-muted-foreground">
                {run.rows} rows in {run.duration_ms}ms
              </p>
            </div>
          )}
          {run.error && (
            <div>
              <h4 className="text-sm font-semibold text-destructive">Error</h4>
              <p className="text-sm text-destructive">{run.error}</p>
            </div>
          )}
        </TabsContent>

        {run.sql && (
          <TabsContent value="sql">
            <pre className="overflow-x-auto rounded bg-muted p-4 text-xs font-mono">{run.sql}</pre>
          </TabsContent>
        )}

        {run.chart_spec && (
          <TabsContent value="chart">
            <VegaLiteChart spec={run.chart_spec} />
          </TabsContent>
        )}

        {run.sample && (
          <TabsContent value="data">
            <pre className="overflow-x-auto rounded bg-muted p-4 text-xs font-mono">
              {JSON.stringify(run.sample, null, 2)}
            </pre>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
