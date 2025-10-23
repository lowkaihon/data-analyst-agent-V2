import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sanitizeTableName } from "@/lib/sql-guard"
import type { ColumnStat } from "@/lib/types"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const datasetId = searchParams.get("datasetId")

    if (!datasetId) {
      return NextResponse.json({ error: "Dataset ID is required" }, { status: 400 })
    }

    const supabase = await createClient()
    const tableName = sanitizeTableName(datasetId)

    const { data, error } = await supabase.from(tableName).select("*").limit(1000)

    if (error || !data || data.length === 0) {
      return NextResponse.json({ error: "Failed to fetch schema data" }, { status: 500 })
    }

    const columns = Object.keys(data[0]).filter((col) => col !== "id")
    const columnStats: ColumnStat[] = columns.map((col) => {
      const values = data.map((row) => row[col]).filter((v) => v !== null && v !== undefined)
      const nullCount = data.length - values.length

      const stat: ColumnStat = {
        name: col,
        type: typeof values[0] === "number" ? "number" : typeof values[0] === "boolean" ? "boolean" : "string",
        null_count: nullCount,
        null_percent: (nullCount / data.length) * 100,
        unique_count: new Set(values).size,
      }

      if (typeof values[0] === "number") {
        stat.min = Math.min(...(values as number[]))
        stat.max = Math.max(...(values as number[]))
      }

      return stat
    })

    return NextResponse.json({ columns: columnStats })
  } catch (error) {
    console.error("[v0] Schema error:", error)
    return NextResponse.json({ error: "Failed to fetch schema" }, { status: 500 })
  }
}
