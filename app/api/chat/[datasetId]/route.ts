import { openai } from "@ai-sdk/openai"
import { convertToModelMessages, streamText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { getPostgresPool } from "@/lib/postgres"
import { guardSQL } from "@/lib/sql-guard"
import { createServerClient } from "@/lib/supabase/server"

export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ datasetId: string }> }) {
  try {
    console.log("[v0] Chat API route called")

    // Extract datasetId from route params
    const { datasetId } = await params
    console.log("[v0] DatasetId from route params:", datasetId)

    if (!datasetId) {
      console.log("[v0] Missing datasetId in route params")
      return new Response("Missing datasetId", { status: 400 })
    }

    const body = await req.json()
    console.log("[v0] Request body keys:", Object.keys(body))

    let messages = body.messages
    if (!messages || !Array.isArray(messages)) {
      return new Response("Invalid messages format", { status: 400 })
    }

    // Fetch dataset metadata
    const supabase = await createServerClient()
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .select("*")
      .eq("id", datasetId)
      .single()

    if (datasetError || !dataset) {
      console.error("[v0] Dataset fetch error:", datasetError)
      return new Response("Dataset not found", { status: 404 })
    }

    console.log("[v0] Dataset found:", dataset.table_name)

    const isInitMessage =
      messages.length === 1 &&
      messages[0].role === "user" &&
      messages[0].parts?.some((p: any) => p.type === "text" && p.text === "__INIT__")

    if (isInitMessage) {
      console.log("[v0] Detected init message, replacing with greeting prompt")
      // Replace __INIT__ with a proper greeting prompt
      messages = [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: dataset.user_context
                ? `I've uploaded a dataset with this context: "${dataset.user_context}". Please analyze the dataset structure and verify if it matches my description, then suggest what I should explore.`
                : "I've uploaded a dataset. Please analyze its structure and suggest interesting questions or analyses I could explore.",
            },
          ],
        },
      ]
    }

    const pool = getPostgresPool()

    const tools = {
      executeSQLQuery: tool({
        description: `Execute a SELECT query against the dataset table to explore data and uncover insights.

IMPORTANT GUIDELINES:
- Use LIMIT clauses (typically 100 or less) to avoid large result sets
- Write efficient queries that answer specific analytical questions
- Use aggregate functions (COUNT, SUM, AVG, MAX, MIN) strategically
- Leverage GROUP BY for segmentation and comparison analysis
- Use WHERE clauses to filter for relevant data
- Build queries that reveal patterns, anomalies, or actionable insights

QUERY EXAMPLES:
- Distribution: "SELECT category, COUNT(*) as count FROM table GROUP BY category ORDER BY count DESC LIMIT 10"
- Trends: "SELECT date_column, AVG(metric) as avg_value FROM table GROUP BY date_column ORDER BY date_column"
- Segmentation: "SELECT segment, AVG(value) as avg, COUNT(*) as count FROM table GROUP BY segment"
- Top performers: "SELECT name, metric FROM table ORDER BY metric DESC LIMIT 10"

Results will be stored in the SQL tab for the user to review.`,
        inputSchema: z.object({
          query: z.string().describe("The SQL SELECT query to execute. Must be a SELECT statement only."),
          reasoning: z.string().describe("Brief explanation of what insight this query will reveal"),
        }),
        execute: async ({ query, reasoning }) => {
          console.log("[v0] Executing SQL:", query)
          console.log("[v0] Reasoning:", reasoning)

          const startTime = Date.now()

          try {
            // Guard SQL to ensure it's SELECT-only and add LIMIT
            const guardedSQL = guardSQL(query, dataset.table_name)
            const result = await pool.query(guardedSQL)
            const durationMs = Date.now() - startTime

            // Store in runs table with correct schema
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              type: "sql",
              status: "success",
              sql: guardedSQL,
              rows: result.rowCount || 0,
              duration_ms: durationMs,
              insight: reasoning,
              sample: result.rows, // Store actual results as JSONB
            })

            return {
              success: true,
              rows: result.rows,
              rowCount: result.rowCount,
              reasoning,
            }
          } catch (error: any) {
            console.error("[v0] SQL execution error:", error)
            const durationMs = Date.now() - startTime

            // Store failed query
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              type: "sql",
              status: "failed",
              sql: query,
              duration_ms: durationMs,
              error: error.message,
              insight: reasoning,
            })

            return {
              success: false,
              error: error.message,
              reasoning,
            }
          }
        },
      }),

      suggestViz: tool({
        description: `Generate a professional Vega-Lite visualization based on data analysis results.

WHEN TO USE WHICH CHART TYPE:
- bar: Compare categories, show distributions, rank items
- line: Show trends over time, display continuous changes
- scatter: Explore relationships between two variables, identify correlations
- area: Show cumulative values, emphasize magnitude of change over time
- pie: Display proportions (use sparingly, bars often better)

STYLING GUIDELINES:
- Professional color scheme with proper contrast
- Clear axis labels with readable font sizes
- Interactive tooltips for data exploration
- Proper number formatting (integers: ",.0f", decimals: ",.2f", percentages: ".1%")
- Appropriate dimensions (width: 500-600, height: 300-400)
- Clean spacing and padding

The chart will be displayed in the Charts tab for the user to view.`,
        inputSchema: z.object({
          data: z.array(z.record(z.any())).describe("The data rows to visualize"),
          chartType: z.enum(["bar", "line", "scatter", "area", "pie"]).describe("The type of chart to create"),
          xField: z.string().describe("The field to use for x-axis (or theta for pie)"),
          yField: z.string().describe("The field to use for y-axis (or radius for pie)"),
          title: z.string().describe("Clear, descriptive chart title"),
          xAxisLabel: z.string().optional().describe("Custom x-axis label"),
          yAxisLabel: z.string().optional().describe("Custom y-axis label"),
        }),
        execute: async ({ data, chartType, xField, yField, title, xAxisLabel, yAxisLabel }) => {
          console.log("[v0] Generating chart:", chartType)

          // Base configuration for professional styling
          const baseConfig = {
            axis: {
              labelFontSize: 11,
              titleFontSize: 13,
              labelFont: "system-ui, -apple-system, sans-serif",
              titleFont: "system-ui, -apple-system, sans-serif",
            },
            legend: {
              labelFontSize: 11,
              titleFontSize: 12,
            },
            title: {
              fontSize: 16,
              font: "system-ui, -apple-system, sans-serif",
              anchor: "start",
              fontWeight: 600,
            },
          }

          // Determine field types (simple heuristic)
          const sampleValue = data[0]?.[xField]
          const isXTemporal = !isNaN(Date.parse(sampleValue))
          const xType = isXTemporal ? "temporal" : typeof sampleValue === "number" ? "quantitative" : "nominal"

          let spec: any = {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            title,
            width: 550,
            height: 350,
            data: { values: data },
            config: baseConfig,
          }

          // Chart-specific configurations
          if (chartType === "bar") {
            spec.mark = { type: "bar", cornerRadiusEnd: 4, tooltip: true }
            spec.encoding = {
              x: {
                field: xField,
                type: xType,
                axis: { labelAngle: 0, title: xAxisLabel || xField },
              },
              y: {
                field: yField,
                type: "quantitative",
                axis: { format: ",.0f", title: yAxisLabel || yField },
              },
              color: { value: "#4c78a8" },
              tooltip: [
                { field: xField, type: xType },
                { field: yField, type: "quantitative", format: ",.0f" },
              ],
            }
            spec.config.bar = { discreteBandSize: 40 }
          } else if (chartType === "line") {
            spec.mark = { type: "line", point: true, tooltip: true, strokeWidth: 2 }
            spec.encoding = {
              x: {
                field: xField,
                type: xType,
                axis: { title: xAxisLabel || xField, labelAngle: -45 },
              },
              y: {
                field: yField,
                type: "quantitative",
                axis: { format: ",.0f", title: yAxisLabel || yField },
              },
              color: { value: "#4c78a8" },
              tooltip: [
                { field: xField, type: xType },
                { field: yField, type: "quantitative", format: ",.2f" },
              ],
            }
          } else if (chartType === "scatter") {
            spec.mark = { type: "circle", size: 80, opacity: 0.7, tooltip: true }
            spec.encoding = {
              x: {
                field: xField,
                type: "quantitative",
                axis: { format: ",.0f", title: xAxisLabel || xField },
              },
              y: {
                field: yField,
                type: "quantitative",
                axis: { format: ",.0f", title: yAxisLabel || yField },
              },
              color: { value: "#4c78a8" },
              tooltip: [
                { field: xField, type: "quantitative", format: ",.2f" },
                { field: yField, type: "quantitative", format: ",.2f" },
              ],
            }
          } else if (chartType === "area") {
            spec.mark = { type: "area", line: true, point: false, tooltip: true }
            spec.encoding = {
              x: {
                field: xField,
                type: xType,
                axis: { title: xAxisLabel || xField, labelAngle: -45 },
              },
              y: {
                field: yField,
                type: "quantitative",
                axis: { format: ",.0f", title: yAxisLabel || yField },
              },
              color: { value: "#4c78a8" },
              tooltip: [
                { field: xField, type: xType },
                { field: yField, type: "quantitative", format: ",.0f" },
              ],
            }
          } else if (chartType === "pie") {
            spec.mark = { type: "arc", tooltip: true }
            spec.encoding = {
              theta: { field: yField, type: "quantitative" },
              color: {
                field: xField,
                type: "nominal",
                legend: { title: xField },
              },
              tooltip: [
                { field: xField, type: "nominal" },
                { field: yField, type: "quantitative", format: ",.0f" },
              ],
            }
            spec.view = { stroke: null }
          }

          // Store in runs table with correct schema
          const supabase = await createServerClient()
          await supabase.from("runs").insert({
            dataset_id: datasetId,
            type: "chart",
            status: "success",
            chart_spec: spec,
            insight: title, // Use chart title as the insight
          })

          return {
            success: true,
            spec,
          }
        },
      }),

      validate: tool({
        description:
          "Check data quality by analyzing null values, duplicates, outliers, or data type issues. Use this to identify potential data problems.",
        inputSchema: z.object({
          checkType: z.enum(["nulls", "duplicates", "outliers", "types"]).describe("The type of validation to perform"),
          column: z.string().optional().describe("Specific column to check (optional)"),
        }),
        execute: async ({ checkType, column }) => {
          console.log("[v0] Validating data:", checkType, column)

          try {
            let query = ""
            if (checkType === "nulls") {
              query = column
                ? `SELECT COUNT(*) as null_count FROM ${dataset.table_name} WHERE ${column} IS NULL`
                : `SELECT COUNT(*) as total_rows FROM ${dataset.table_name}`
            } else if (checkType === "duplicates") {
              query = `SELECT COUNT(*) - COUNT(DISTINCT *) as duplicate_count FROM ${dataset.table_name}`
            }

            const result = await pool.query(query)
            const validationResult = result.rows[0]

            // Create insight message
            const insightMsg = column
              ? `${checkType} check on column '${column}': ${JSON.stringify(validationResult)}`
              : `${checkType} check: ${JSON.stringify(validationResult)}`

            // Store in runs table with correct schema
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              type: "validate",
              status: "success",
              sql: query,
              insight: insightMsg,
              sample: validationResult,
            })

            return {
              success: true,
              result: validationResult,
              checkType,
              column,
            }
          } catch (error: any) {
            console.error("[v0] Validation error:", error)

            // Store failed validation
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              type: "validate",
              status: "failed",
              error: error.message,
              insight: `Validation ${checkType} failed${column ? ` on column ${column}` : ""}`,
            })

            return {
              success: false,
              error: error.message,
            }
          }
        },
      }),

      profile: tool({
        description:
          "Generate statistical summary of the dataset including row count, column types, and basic statistics. Use this to understand the dataset structure.",
        inputSchema: z.object({
          includeStats: z.boolean().describe("Whether to include detailed statistics"),
        }),
        execute: async ({ includeStats }) => {
          console.log("[v0] Profiling dataset")

          try {
            // Get column information
            const schemaQuery = `
              SELECT column_name, data_type 
              FROM information_schema.columns 
              WHERE table_name = $1
              ORDER BY ordinal_position
            `
            const schemaResult = await pool.query(schemaQuery, [dataset.table_name])

            const profile = {
              tableName: dataset.table_name,
              rowCount: dataset.row_count,
              columnCount: dataset.column_count,
              columns: schemaResult.rows,
              userContext: dataset.user_context,
            }

            // Create insight summary
            const columnSummary = schemaResult.rows.map((r) => `${r.column_name} (${r.data_type})`).join(", ")
            const insightMsg = `Dataset profile: ${dataset.row_count} rows, ${dataset.column_count} columns - ${columnSummary}`

            // Store in runs table with correct schema
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              type: "summarize",
              status: "success",
              insight: insightMsg,
              sample: profile,
            })

            return {
              success: true,
              profile,
            }
          } catch (error: any) {
            console.error("[v0] Profile error:", error)

            // Store failed profile
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              type: "summarize",
              status: "failed",
              error: error.message,
              insight: "Dataset profiling failed",
            })

            return {
              success: false,
              error: error.message,
            }
          }
        },
      }),
    }

    const systemPrompt = dataset.user_context
      ? `You are a data analyst AI assistant. The user has provided this context about their data: "${dataset.user_context}"

Dataset: ${dataset.table_name} (${dataset.row_count} rows, ${dataset.column_count} columns)

ANALYSIS PHILOSOPHY - Focus on Actionable Insights:
Your analysis should go beyond descriptive statistics to deliver actionable insights. Structure your thinking to answer:
1. WHAT is happening? (descriptive - trends, patterns, distributions)
2. WHY is it happening? (diagnostic - correlations, segmentation, comparisons)
3. WHAT should be done? (prescriptive - opportunities, priorities, recommendations)

Design your analysis to:
- Identify patterns and anomalies that indicate opportunities or problems
- Compare segments, time periods, or categories to find disparities
- Quantify impact and prioritize by significance
- Surface insights that connect directly to decisions and actions

COMMUNICATION GUIDELINES:
- When greeting: Provide a brief, friendly welcome and 2-3 concise suggested questions to explore
- After exploration: Provide a BRIEF summary (2-3 sentences max) of key findings
- Keep responses conversational and concise - don't overwhelm with data dumps
- Reference where artifacts are stored: "See the SQL tab for the query" or "I've added a chart to the Charts tab"
- Suggest natural next steps that build toward actionable insights

SQL BEST PRACTICES:
- Always use LIMIT clauses to avoid large result sets (typically LIMIT 100 or less)
- Write efficient queries that answer specific analytical questions
- Use aggregate functions, GROUP BY, and window functions strategically
- Build queries that reveal insights, not just dump data

Be conversational, insightful, and help the user discover valuable insights without being verbose.`
      : `You are a data analyst AI assistant.

Dataset: ${dataset.table_name} (${dataset.row_count} rows, ${dataset.column_count} columns)

ANALYSIS PHILOSOPHY - Focus on Actionable Insights:
Your analysis should go beyond descriptive statistics to deliver actionable insights. Structure your thinking to answer:
1. WHAT is happening? (descriptive - trends, patterns, distributions)
2. WHY is it happening? (diagnostic - correlations, segmentation, comparisons)
3. WHAT should be done? (prescriptive - opportunities, priorities, recommendations)

Design your analysis to:
- Identify patterns and anomalies that indicate opportunities or problems
- Compare segments, time periods, or categories to find disparities
- Quantify impact and prioritize by significance
- Surface insights that connect directly to decisions and actions

COMMUNICATION GUIDELINES:
- When greeting: Provide a brief, friendly welcome and 2-3 concise suggested questions to explore
- After exploration: Provide a BRIEF summary (2-3 sentences max) of key findings
- Keep responses conversational and concise - don't overwhelm with data dumps
- Reference where artifacts are stored: "See the SQL tab for the query" or "I've added a chart to the Charts tab"
- Suggest natural next steps that build toward actionable insights

SQL BEST PRACTICES:
- Always use LIMIT clauses to avoid large result sets (typically LIMIT 100 or less)
- Write efficient queries that answer specific analytical questions
- Use aggregate functions, GROUP BY, and window functions strategically
- Build queries that reveal insights, not just dump data

Be conversational, insightful, and help the user discover valuable insights without being verbose.`

    console.log("[v0] Starting streamText with", messages.length, "messages")

    const result = streamText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages: convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(10),
      onStepFinish: ({ toolCalls, toolResults }) => {
        console.log("[v0] Step finished")
        if (toolCalls) {
          console.log(
            "[v0] Tool calls:",
            toolCalls.map((tc) => tc.toolName),
          )
        }
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (error: any) {
    console.error("[v0] Chat API error:", error)
    return new Response(error.message || "Internal server error", {
      status: 500,
    })
  }
}
