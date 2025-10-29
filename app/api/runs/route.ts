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

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // Verify user owns the dataset
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .select("id")
      .eq("id", datasetId)
      .single()

    if (datasetError || !dataset) {
      return NextResponse.json({ error: "Dataset not found or access denied" }, { status: 404 })
    }

    // Build query with count - RLS will automatically filter by user_id
    let query = supabase.from("runs").select("*", { count: "exact" }).eq("dataset_id", datasetId).order("time_iso", { ascending: false })

    if (type) {
      query = query.eq("type", type)
    }

    const { data, error, count } = await query

    if (error) {
      console.error("Runs fetch error:", error)
      return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 })
    }

    return NextResponse.json({ runs: data || [], totalCount: count || 0 })
  } catch (error) {
    console.error("Runs error:", error)
    return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 })
  }
}
