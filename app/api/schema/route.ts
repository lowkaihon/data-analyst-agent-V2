import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres"
import { validateTableName } from "@/lib/sql-guard"
import type { ColumnStat } from "@/lib/types"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const datasetId = searchParams.get("datasetId")

    if (!datasetId) {
      return NextResponse.json({ error: "Dataset ID is required" }, { status: 400 })
    }

    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // Fetch dataset to get table name and verify ownership
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .select("table_name, user_id")
      .eq("id", datasetId)
      .single()

    if (datasetError || !dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 })
    }

    // Verify ownership (defense in depth alongside RLS)
    if (dataset.user_id !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    const tableName = dataset.table_name

    // Validate table name before using in SQL queries
    if (!validateTableName(tableName)) {
      return NextResponse.json({ error: "Invalid table name format" }, { status: 400 })
    }

    const pool = getPostgresPool()

    // Get column names and types from information_schema
    const columnsQuery = `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = $1 AND column_name != 'id'
      ORDER BY ordinal_position
    `
    const columnsResult = await pool.query(columnsQuery, [tableName])

    if (columnsResult.rows.length === 0) {
      return NextResponse.json({ error: "No columns found" }, { status: 500 })
    }

    // Get total row count
    const countQuery = `SELECT COUNT(*) as total FROM ${tableName}`
    const countResult = await pool.query(countQuery)
    const totalRows = parseInt(countResult.rows[0].total)

    // Build a single stats query for all columns (avoids N+1 round trips)
    const statsUnions = columnsResult.rows.map(col => {
      const cn = col.column_name
      return `SELECT
        '${cn}' as col_name,
        '${col.data_type}' as data_type,
        COUNT(*) FILTER (WHERE "${cn}" IS NULL) as null_count,
        COUNT(DISTINCT "${cn}") as unique_count,
        MIN("${cn}"::text) as min_val,
        MAX("${cn}"::text) as max_val
      FROM ${tableName}`
    }).join(' UNION ALL ')

    const statsResult = await pool.query(statsUnions)

    // Map results to ColumnStat array
    const columnStats: ColumnStat[] = statsResult.rows.map(stats => {
      let type: "number" | "boolean" | "string"
      if (stats.data_type === "integer" || stats.data_type === "double precision" || stats.data_type === "numeric") {
        type = "number"
      } else if (stats.data_type === "boolean") {
        type = "boolean"
      } else {
        type = "string"
      }

      const stat: ColumnStat = {
        name: stats.col_name,
        type: type,
        null_count: parseInt(stats.null_count),
        null_percent: (parseInt(stats.null_count) / totalRows) * 100,
        unique_count: parseInt(stats.unique_count),
      }

      if (type === "number" && stats.min_val !== null) {
        stat.min = parseFloat(stats.min_val)
        stat.max = parseFloat(stats.max_val)
      }

      return stat
    })

    return NextResponse.json({ columns: columnStats })
  } catch (error) {
    console.error("Schema error:", error)
    return NextResponse.json({ error: "Failed to fetch schema" }, { status: 500 })
  }
}
