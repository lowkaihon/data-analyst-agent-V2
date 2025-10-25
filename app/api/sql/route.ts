import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { validateReadOnlySQL, ensureLimit } from "@/lib/sql-guard"

export async function POST(req: NextRequest) {
  try {
    const { datasetId, sql, limit } = await req.json()

    if (!datasetId || !sql) {
      return NextResponse.json({ error: "Dataset ID and SQL query are required" }, { status: 400 })
    }

    // Validate SQL is read-only
    const validation = validateReadOnlySQL(sql)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Ensure LIMIT is applied
    const safeSql = ensureLimit(sql, limit || 500)

    const supabase = await createClient()

    // Fetch dataset to get table name
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .select("table_name")
      .eq("id", datasetId)
      .single()

    if (datasetError || !dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 })
    }

    const tableName = dataset.table_name

    const startTime = Date.now()

    // Execute query with timeout
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Query timeout")), 5000))

    const queryPromise = supabase
      .from(tableName)
      .select("*")
      .limit(limit || 500)

    const { data, error } = (await Promise.race([queryPromise, timeoutPromise])) as any

    const durationMs = Date.now() - startTime

    if (error) {
      // Log failed run
      await supabase.from("runs").insert({
        dataset_id: datasetId,
        type: "sql",
        status: "failed",
        sql: safeSql,
        duration_ms: durationMs,
        error: error.message,
      })

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Log successful run
    await supabase.from("runs").insert({
      dataset_id: datasetId,
      type: "sql",
      status: "success",
      sql: safeSql,
      rows: data?.length || 0,
      duration_ms: durationMs,
      sample: data?.slice(0, 5),
    })

    return NextResponse.json({
      columns: data && data.length > 0 ? Object.keys(data[0]) : [],
      rows: data || [],
      rowCount: data?.length || 0,
      durationMs,
    })
  } catch (error) {
    console.error("SQL execution error:", error)
    return NextResponse.json({ error: "Failed to execute query" }, { status: 500 })
  }
}
