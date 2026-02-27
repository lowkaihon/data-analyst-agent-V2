"use client"

import { useEffect, useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TabLoadingState, TabErrorState } from "@/components/tabs/tab-states"
import type { ColumnStat } from "@/lib/types"

interface SchemaTabProps {
  datasetId: string
}

export function SchemaTab({ datasetId }: SchemaTabProps) {
  const [columns, setColumns] = useState<ColumnStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSchema() {
      try {
        const response = await fetch(`/api/schema?datasetId=${datasetId}`)
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || "Failed to fetch schema")
        }

        setColumns(result.columns)
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred")
      } finally {
        setLoading(false)
      }
    }

    fetchSchema()
  }, [datasetId])

  if (loading) return <TabLoadingState />
  if (error) return <TabErrorState error={error} />

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 pb-8">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Dataset Schema</h3>
          <p className="text-sm text-muted-foreground">{columns.length} columns</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Column Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Null %</TableHead>
              <TableHead>Unique</TableHead>
              <TableHead>Min</TableHead>
              <TableHead>Max</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map((col) => (
              <TableRow key={col.name}>
                <TableCell className="font-medium">{col.name}</TableCell>
                <TableCell className="font-mono text-xs">{col.type}</TableCell>
                <TableCell>{col.null_percent.toFixed(1)}%</TableCell>
                <TableCell>{col.unique_count}</TableCell>
                <TableCell>{col.min !== null && col.min !== undefined ? String(col.min) : "-"}</TableCell>
                <TableCell>{col.max !== null && col.max !== undefined ? String(col.max) : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
