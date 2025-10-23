import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  try {
    const { datasetId } = await req.json()

    if (!datasetId) {
      return NextResponse.json({ error: "Dataset ID is required" }, { status: 400 })
    }

    // Check for API key
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 })
    }

    const supabase = await createClient()

    // Fetch dataset metadata
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .select("*")
      .eq("id", datasetId)
      .single()

    if (datasetError || !dataset) {
      console.error("[v0] Dataset fetch error:", datasetError)
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 })
    }

    // Fetch pinned runs (with fallback to recent runs if nothing pinned)
    let { data: runs, error: runsError } = await supabase
      .from("runs")
      .select("*")
      .eq("dataset_id", datasetId)
      .eq("pinned", true)
      .order("time_iso", { ascending: true })

    if (runsError) {
      console.error("[v0] Runs fetch error:", runsError)
      return NextResponse.json({ error: "Failed to fetch analysis data" }, { status: 500 })
    }

    // Fallback: if no pinned runs, get recent 20 runs
    if (!runs || runs.length === 0) {
      const { data: recentRuns } = await supabase
        .from("runs")
        .select("*")
        .eq("dataset_id", datasetId)
        .eq("status", "success")
        .order("time_iso", { ascending: false })
        .limit(20)

      runs = recentRuns || []
    }

    if (!runs || runs.length === 0) {
      return NextResponse.json({
        title: "Data Analysis Report",
        markdown:
          "# No Analysis Data\n\nNo analysis has been performed yet. Please chat with the AI to explore your dataset, then generate a report.",
      })
    }

    // Get dataset schema
    const { data: schemaData } = await supabase.rpc("get_table_schema", {
      table_name: dataset.table_name,
    })

    // Fallback schema fetch if RPC doesn't exist
    let schema: Array<{ name: string; type: string }> = []
    if (schemaData) {
      schema = schemaData.map((col: any) => ({
        name: col.column_name,
        type: col.data_type,
      }))
    } else {
      // Manual schema query fallback
      const { data: cols } = await supabase
        .from("information_schema.columns")
        .select("column_name, data_type")
        .eq("table_name", dataset.table_name)
      if (cols) {
        schema = cols.map((col: any) => ({ name: col.column_name, type: col.data_type }))
      }
    }

    // Build SQL history from runs
    const sqlRuns = runs.filter((r) => r.type === "sql" && r.status === "success")
    const sqlHistory = sqlRuns.map((run) => ({
      sql: run.sql || "",
      result: run.sample
        ? {
            columns: Object.keys(run.sample[0] || {}),
            rows: run.sample.map((row: any) => Object.values(row)),
          }
        : undefined,
      reasoning: run.insight,
    }))

    // Count charts
    const charts = runs.filter((r) => r.type === "chart")

    // Build exploration summary from insights
    const insights = runs.filter((r) => r.insight).map((r) => r.insight)
    const explorationSummary = insights.length > 0 ? insights.join("\n\n") : undefined

    // Build the AI prompt
    const systemPrompt = `You are a data analyst creating a comprehensive markdown report focused on delivering ACTIONABLE INSIGHTS.

Dataset: ${dataset.table_name}
${dataset.user_context ? `User Context: ${dataset.user_context}\n` : ""}
Schema:
${schema.map((col) => `- ${col.name} (${col.type})`).join("\n")}

Total Rows: ${dataset.row_count?.toLocaleString() || "Unknown"}

${
  explorationSummary
    ? `
Previous Analysis Insights:
${explorationSummary}

The above insights were captured during analysis. Use them as context but base your report on the actual SQL query results below.
`
    : ""
}

Analysis Performed:
${sqlHistory
  .map(
    (item, idx) => `
Query ${idx + 1}:
\`\`\`sql
${item.sql}
\`\`\`
${item.reasoning ? `Purpose: ${item.reasoning}\n` : ""}
${
  item.result
    ? `
Results (${item.result.rows.length} rows):
Columns: ${item.result.columns.join(", ")}

Data (showing first ${Math.min(50, item.result.rows.length)} rows):
${JSON.stringify(
  item.result.rows.slice(0, 50).map((row: any) => {
    const obj: Record<string, unknown> = {}
    item.result!.columns.forEach((col, idx) => {
      obj[col] = row[idx]
    })
    return obj
  }),
  null,
  2,
)}
${item.result.rows.length > 50 ? `\n(${item.result.rows.length - 50} more rows not shown)` : ""}
`
    : "No results available"
}
`,
  )
  .join("\n")}

${charts.length > 0 ? `\n${charts.length} visualization(s) were created during analysis.\n` : ""}

Create a professional markdown report that delivers ACTIONABLE INSIGHTS:

CRITICAL - Actionable Insights Framework:
An actionable insight must be:
• Specific: Pinpoint distinct problems or opportunities, not vague observations
• Measurable: Include concrete metrics that can be tracked
• Relevant: Connect directly to business goals and decision-making
• Timely: Provide context about urgency and timing
• Achievable: Recommend realistic, implementable actions

Report Structure:
1. Executive Summary
   - One-sentence overview of the analysis
   - 2-3 key actionable insights (what to do about the findings)

2. Key Findings
   - Present discoveries using ACTUAL DATA from SQL results
   - For each finding, explain WHAT happened and WHY it matters
   - Include specific numbers, percentages, trends, and comparisons
   - Identify patterns, anomalies, and correlations

3. Actionable Insights & Recommendations
   For each major finding, provide:
   - Clear insight statement (the "so what?")
   - Specific recommended action (what to do)
   - Expected impact (why this matters)
   - Implementation priority (high/medium/low based on impact)
   - Success metrics to track

4. Methodology
   - Briefly describe analytical approach and queries used
   - Note any limitations or data quality considerations

IMPORTANT GUIDELINES:
- Use actual numbers, values, and patterns from the SQL results - be specific, not generic
- Focus on insights that bridge analysis to action
- Avoid stating obvious facts without interpretation
- Connect findings to business decisions
- Prioritize recommendations by potential impact
- Use clear, concise language that non-technical stakeholders can understand

Use proper markdown formatting with headers, lists, bold for emphasis, and tables where appropriate.`

    const result = await generateText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      prompt: `Generate a comprehensive analysis report for the dataset "${dataset.table_name}"${dataset.user_context ? ` with context: "${dataset.user_context}"` : ""}.`,
    })

    return NextResponse.json({
      title: "Analysis Report",
      markdown: result.text,
    })
  } catch (error) {
    console.error("[v0] Report generation error:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate report",
      },
      { status: 500 },
    )
  }
}
