"use client"

import { useEffect, useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TabLoadingState, TabErrorState } from "@/components/tabs/tab-states"

interface PreviewTabProps {
  datasetId: string
}

export function PreviewTab({ datasetId }: PreviewTabProps) {
  const [data, setData] = useState<any[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchPreview() {
      try {
        const response = await fetch(`/api/preview?datasetId=${datasetId}`)
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || "Failed to fetch preview")
        }

        setColumns(result.columns)
        setData(result.rows)
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred")
      } finally {
        setLoading(false)
      }
    }

    fetchPreview()
  }, [datasetId])

  if (loading) return <TabLoadingState />
  if (error) return <TabErrorState error={error} />

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs text-muted-foreground">Only first 100 rows shown</p>
      </div>
      <div className="flex-1 overflow-auto px-4 pb-4">
        <Table className="min-w-max">
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col} className="font-semibold whitespace-nowrap">
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, idx) => (
              <TableRow key={idx}>
                {columns.map((col) => (
                  <TableCell key={col} className="whitespace-nowrap">
                    {String(row[col] ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
