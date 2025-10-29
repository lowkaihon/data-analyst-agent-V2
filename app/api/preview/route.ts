import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Validate table name to prevent SQL injection
function validateTableName(tableName: string): boolean {
  // Only allow ds_<uuid with underscores> format (e.g., ds_550e8400_e29b_41d4_a716_446655440000)
  return /^ds_[a-f0-9_]{36}$/.test(tableName)
}

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

    // Fetch first 100 rows
    const { data, error } = await supabase.from(tableName).select("*").limit(100)

    if (error) {
      console.error("Preview fetch error:", error)
      return NextResponse.json({ error: "Failed to fetch preview data" }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ columns: [], rows: [] })
    }

    const columns = Object.keys(data[0]).filter((col) => col !== "id")

    return NextResponse.json({
      columns,
      rows: data,
    })
  } catch (error) {
    console.error("Preview error:", error)
    return NextResponse.json({ error: "Failed to fetch preview" }, { status: 500 })
  }
}
