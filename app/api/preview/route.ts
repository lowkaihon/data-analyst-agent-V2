import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const datasetId = searchParams.get("datasetId")

    if (!datasetId) {
      return NextResponse.json({ error: "Dataset ID is required" }, { status: 400 })
    }

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

    // Fetch first 100 rows
    const { data, error } = await supabase.from(tableName).select("*").limit(100)

    if (error) {
      console.error("[v0] Preview fetch error:", error)
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
    console.error("[v0] Preview error:", error)
    return NextResponse.json({ error: "Failed to fetch preview" }, { status: 500 })
  }
}
