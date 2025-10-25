import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const datasetId = searchParams.get("datasetId")
    const type = searchParams.get("type")

    if (!datasetId) {
      return NextResponse.json({ error: "Dataset ID is required" }, { status: 400 })
    }

    const supabase = await createClient()

    let query = supabase.from("runs").select("*").eq("dataset_id", datasetId).order("time_iso", { ascending: false })

    if (type) {
      query = query.eq("type", type)
    }

    const { data, error } = await query

    if (error) {
      console.error("Runs fetch error:", error)
      return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 })
    }

    return NextResponse.json({ runs: data || [] })
  } catch (error) {
    console.error("Runs error:", error)
    return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 })
  }
}
