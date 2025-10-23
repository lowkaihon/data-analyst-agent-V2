import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  try {
    const { datasetId } = await req.json()

    if (!datasetId) {
      return NextResponse.json({ error: "Dataset ID is required" }, { status: 400 })
    }

    const supabase = await createClient()

    // Fetch pinned runs
    const { data: runs, error } = await supabase
      .from("runs")
      .select("*")
      .eq("dataset_id", datasetId)
      .eq("pinned", true)
      .order("time_iso", { ascending: true })

    if (error) {
      console.error("[v0] Report generation error:", error)
      return NextResponse.json({ error: "Failed to generate report" }, { status: 500 })
    }

    // Generate markdown report
    let markdown = "# Data Analysis Report\n\n"
    markdown += `Generated: ${new Date().toLocaleString()}\n\n`

    markdown += "## Executive Summary\n\n"
    markdown += "This report summarizes key findings from the data analysis.\n\n"

    markdown += "## Key Findings\n\n"
    const insights = runs?.filter((r) => r.insight) || []
    if (insights.length > 0) {
      insights.forEach((run, idx) => {
        markdown += `${idx + 1}. ${run.insight}\n`
      })
    } else {
      markdown += "No insights pinned yet.\n"
    }
    markdown += "\n"

    markdown += "## SQL Queries\n\n"
    const sqlRuns = runs?.filter((r) => r.type === "sql") || []
    if (sqlRuns.length > 0) {
      sqlRuns.forEach((run, idx) => {
        markdown += `### Query ${idx + 1}\n\n`
        markdown += "```sql\n"
        markdown += run.sql || ""
        markdown += "\n```\n\n"
        markdown += `Results: ${run.rows} rows in ${run.duration_ms}ms\n\n`
      })
    }

    markdown += "## Visualizations\n\n"
    const chartRuns = runs?.filter((r) => r.type === "chart") || []
    if (chartRuns.length > 0) {
      chartRuns.forEach((run, idx) => {
        markdown += `### Chart ${idx + 1}: ${run.insight || "Visualization"}\n\n`
        markdown += "Chart specification available in the Charts tab.\n\n"
      })
    }

    markdown += "## Data Quality\n\n"
    const validationRuns = runs?.filter((r) => r.type === "validate") || []
    if (validationRuns.length > 0) {
      validationRuns.forEach((run) => {
        markdown += `- ${run.insight}\n`
      })
    } else {
      markdown += "No validation checks performed.\n"
    }

    return NextResponse.json({
      title: "Data Analysis Report",
      markdown,
    })
  } catch (error) {
    console.error("[v0] Report generation error:", error)
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 })
  }
}
