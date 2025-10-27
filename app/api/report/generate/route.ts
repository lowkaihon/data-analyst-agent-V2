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
      console.error("Dataset fetch error:", datasetError)
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 })
    }

    // Fetch pinned runs (guaranteed to be included in report)
    const { data: pinnedRuns, error: pinnedError } = await supabase
      .from("runs")
      .select("*")
      .eq("dataset_id", datasetId)
      .eq("pinned", true)
      .order("time_iso", { ascending: true })

    if (pinnedError) {
      console.error("Pinned runs fetch error:", pinnedError)
      return NextResponse.json({ error: "Failed to fetch analysis data" }, { status: 500 })
    }

    // Calculate remaining slots to reach 50 total items
    const pinnedCount = pinnedRuns?.length || 0
    const remainingSlots = Math.max(0, 50 - pinnedCount)

    // Fetch recent unpinned runs to fill remaining slots (up to 50 total)
    const { data: recentRuns, error: recentError } = await supabase
      .from("runs")
      .select("*")
      .eq("dataset_id", datasetId)
      .eq("status", "success")
      .eq("pinned", false)
      .order("time_iso", { ascending: false })
      .limit(remainingSlots)

    if (recentError) {
      console.error("Recent runs fetch error:", recentError)
      return NextResponse.json({ error: "Failed to fetch analysis data" }, { status: 500 })
    }

    // Combine pinned and recent runs (pinned items always included first)
    const runs = [...(pinnedRuns || []), ...(recentRuns || [])]

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

    // Build detailed chart catalog
    const charts = runs.filter((r) => r.type === "chart")
    const chartCatalog = charts.length > 0
      ? charts.map((chart, idx) => `Chart ${idx + 1}: ${chart.insight || "Untitled Visualization"}`).join("\n")
      : ""

    // Build exploration summary from insights
    const insights = runs.filter((r) => r.insight).map((r) => r.insight)
    const explorationSummary = insights.length > 0 ? insights.join("\n\n") : undefined

    // Extract AI chat responses (especially from deep-dive analysis)
    const aiResponses = runs.filter((r) => r.ai_response && r.ai_response.trim().length > 0)
    const aiResponsesSummary =
      aiResponses.length > 0
        ? aiResponses.map((r, idx) => `Analysis ${idx + 1}:\n${r.ai_response}`).join("\n\n---\n\n")
        : undefined

    // Engineered the AI prompt based on GPT-5 best practices
    const systemPrompt = `<ROLE>
You are an expert data analyst specializing in transforming complex data analysis into clear, actionable business intelligence reports.
</ROLE>

<CONTEXT_GATHERING>
Dataset Name: ${dataset.table_name}
Total Rows: ${dataset.row_count?.toLocaleString() || "Unknown"}
${dataset.user_context ? `\nBusiness Context: ${dataset.user_context}` : ""}

Schema Definition:
${schema.map((col) => `- ${col.name} (${col.type})`).join("\n")}
</CONTEXT_GATHERING>

<DATA_SOURCES>
${
  aiResponsesSummary
    ? `
--- AI Analysis Summaries ---
${aiResponsesSummary}

These comprehensive summaries contain valuable context, patterns, and insights discovered during the exploration process. They provide deep analytical context that should inform your report.
`
    : ""
}

${
  explorationSummary
    ? `
--- Quick Insights (One-sentence Findings) ---
${explorationSummary}
`
    : ""
}

--- SQL Analysis History ---
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

Data Sample (first ${Math.min(5, item.result.rows.length)} rows):
${JSON.stringify(
  item.result.rows.slice(0, 5).map((row: any) => {
    const obj: Record<string, unknown> = {}
    item.result!.columns.forEach((col, idx) => {
      obj[col] = row[idx]
    })
    return obj
  }),
  null,
  2,
)}
${item.result.rows.length > 5 ? `\n(${item.result.rows.length - 5} additional rows not shown)` : ""}
`
    : "No results available"
}
`,
  )
  .join("\n")}

${chartCatalog ? `\n--- Available Visualizations ---\n${chartCatalog}\n\nThese visualizations provide supporting evidence for patterns in the data. Reference them by number when discussing trends or patterns (e.g., "see Chart 2: Revenue Trend Over Time"). While you cannot embed the actual charts in the markdown report, explicitly referencing them helps readers locate relevant visualizations in the Charts tab.\n` : ""}
</DATA_SOURCES>

<TASK>
Generate a comprehensive markdown report that transforms the data analysis above into actionable business intelligence. Your report must bridge the gap between technical findings and business decisions, ensuring every insight leads to a specific, implementable action.
</TASK>

<OUTPUT_STRUCTURE>
Your report MUST include these four sections:

1. Executive Summary
   - One compelling sentence summarizing the analysis scope and purpose
   - 2-3 key actionable insights that decision-makers can act on immediately
   - Each insight must answer "so what?" and "what should we do?"

2. Key Findings
   - Present discoveries using SPECIFIC DATA from the SQL results above
   - For each finding: state WHAT was discovered, include CONCRETE NUMBERS, explain WHY it matters
   - Include exact values, percentages, trends, comparisons, and patterns
   - Identify anomalies, correlations, and statistically significant patterns
   - Reference specific queries by number (e.g., "Query 3 revealed...")
   - When relevant, reference visualizations by number (e.g., "as shown in Chart 2: Revenue Trend Over Time") to help readers locate supporting visual evidence in the Charts tab

3. Actionable Insights & Recommendations
   For EACH major finding, provide a structured recommendation:
   - **Insight:** Clear "so what?" statement connecting finding to business impact
   - **Recommended Action:** Specific, concrete steps to take
   - **Expected Impact:** Quantifiable or qualitative outcomes
   - **Priority:** High/Medium/Low (based on potential impact and urgency)
   - **Success Metrics:** Specific KPIs to track implementation success

4. Methodology & Limitations
   - Summarize the analytical approach (types of queries, analysis techniques)
   - Note any data quality issues, missing data, or analytical limitations
   - Mention assumptions made during analysis
</OUTPUT_STRUCTURE>

<QUALITY_FRAMEWORK>
CRITICAL - Every insight must meet ALL five criteria:

✓ SPECIFIC: Pinpoint exact problems or opportunities with precise details (not "sales are down" but "sales declined 23% in the midwest region")
✓ MEASURABLE: Include concrete metrics and numbers that can be tracked over time
✓ RELEVANT: Connect directly to business goals, decisions, and stakeholder needs
✓ TIMELY: Provide context about urgency, trends over time, and when action is needed
✓ ACHIEVABLE: Recommend realistic actions that can be implemented with available resources
</QUALITY_FRAMEWORK>

<CONSTRAINTS>
DO NOT:
- Make vague generalizations without supporting data from the SQL results
- State obvious facts without interpretation or business context
- Provide insights that cannot be acted upon
- Use technical jargon without explanation for non-technical audiences
- Ignore the AI analysis summaries - they contain critical discovered patterns
- Present findings without connecting them to business implications
- Recommend actions without explaining expected outcomes
- Fabricate or extrapolate data beyond what's provided in the SQL results
- Create generic reports that could apply to any dataset
- Overlook outliers, anomalies, or unexpected patterns in the data

DO:
- Reference available visualizations by number when discussing visual patterns or trends
- Use chart references to help readers locate supporting evidence (e.g., "see Chart 3: Customer Segmentation")
- Make it clear that charts are available in a separate Charts tab for visual confirmation

<REASONING_APPROACH>
Before writing the report, mentally execute these steps:

1. Review all data sources thoroughly (SQL results, AI summaries, insights)
2. Identify the 3-5 most significant patterns, trends, or anomalies
3. For each pattern, ask: "So what? Why does this matter to the business?"
4. Determine specific actions that stakeholders can take based on each finding
5. Prioritize insights by business impact and urgency
6. Structure findings to flow from high-level summary to detailed analysis
7. Ensure every claim is supported by specific data from the provided results
8. Verify that recommendations are realistic and measurable

Work through the entire report systematically. Do not stop until all four sections are complete with rich, specific detail drawn from the actual data provided.
</REASONING_APPROACH>

<FORMATTING>
Use professional markdown formatting:
- Clear header hierarchy (# for main sections, ## for subsections)
- **Bold** for emphasis on key metrics and insights
- Tables for comparative data when appropriate
- Bullet points for lists and action items
- Code blocks for any SQL references (if needed)
- Maintain readability for non-technical stakeholders
</FORMATTING>`

    const result = await generateText({
      model: openai("gpt-5"),
      system: systemPrompt,
      prompt: `Generate a comprehensive analysis report for the dataset "${dataset.table_name}"${dataset.user_context ? ` with context: "${dataset.user_context}"` : ""}.`,
    })

    return NextResponse.json({
      title: "Analysis Report",
      markdown: result.text,
    })
  } catch (error) {
    console.error("Report generation error:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate report",
      },
      { status: 500 },
    )
  }
}
