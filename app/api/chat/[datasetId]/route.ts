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
            const { data: runData, error: insertError } = await supabase.from("runs").insert({
              dataset_id: datasetId,
              type: "sql",
              status: "success",
              sql: guardedSQL,
              rows: result.rowCount || 0,
              duration_ms: durationMs,
              insight: reasoning,
              sample: result.rows, // Store actual results as JSONB
            }).select('id').single()

            if (insertError) {
              console.error("[v0] Error inserting run:", insertError)
            }

            const queryId = runData?.id

            // Return preview (first 5 rows) instead of full dataset to save tokens
            const preview = result.rows.slice(0, 5)

            return {
              success: true,
              queryId: queryId, // ID to reference this query's data
              rowCount: result.rowCount,
              preview: preview, // Small preview for AI to examine
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
        description: `Generate a professional Vega-Lite visualization based on SQL query results.

IMPORTANT: Use the queryId returned from executeSQLQuery - don't manually copy data!

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
          queryId: z.string().describe("The queryId returned from executeSQLQuery tool - used to fetch the data"),
          chartType: z.enum(["bar", "line", "scatter", "area", "pie"]).describe("The type of chart to create"),
          xField: z.string().describe("The field to use for x-axis (or theta for pie)"),
          yField: z.string().describe("The field to use for y-axis (or radius for pie)"),
          title: z.string().describe("Clear, descriptive chart title"),
          xAxisLabel: z.string().optional().describe("Custom x-axis label"),
          yAxisLabel: z.string().optional().describe("Custom y-axis label"),
        }),
        execute: async ({ queryId, chartType, xField, yField, title, xAxisLabel, yAxisLabel }) => {
          console.log("[v0] Generating chart:", chartType, "for queryId:", queryId)

          // Fetch data from runs table using queryId
          const supabaseClient = await createServerClient()
          const { data: runData, error: fetchError } = await supabaseClient
            .from("runs")
            .select("sample")
            .eq("id", queryId)
            .single()

          if (fetchError || !runData) {
            console.error("[v0] Error fetching query data:", fetchError)
            return {
              success: false,
              error: "Failed to fetch query data for visualization",
            }
          }

          const data = runData.sample as any[]

          if (!data || data.length === 0) {
            return {
              success: false,
              error: "No data available to visualize",
            }
          }

          console.log("[v0] Fetched", data.length, "rows for visualization")

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
          const supabaseViz = await createServerClient()
          await supabaseViz.from("runs").insert({
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

    }

    const systemPrompt = `You are an autonomous data analyst AI agent.${dataset.user_context ? ` The user has provided this context about their data: "${dataset.user_context}"` : ''}

Dataset Table: ${dataset.table_name}
Rows: ${dataset.row_count} | Columns: ${dataset.column_count}

CRITICAL: Always use the table name \`${dataset.table_name}\` in ALL SQL queries!

AGENTIC WORKFLOW - Autonomous Exploration & Analysis:

You operate in an iterative, multi-step workflow. For each user question:

1. **EXPLORE** - Execute SQL queries to examine the data
   - Start broad, then refine based on results
   - Use aggregate functions (COUNT, SUM, AVG, GROUP BY) to reveal patterns
   - Always use LIMIT 100 or less to avoid large result sets
   - executeSQLQuery returns: { queryId, rowCount, preview }
     * queryId: Use this to create visualizations
     * preview: First 5 rows to examine structure
   - Examine query results carefully before proceeding

2. **VISUALIZE** - Create charts when they add insight (use your judgment!)

   WHEN TO VISUALIZE:
   ✓ Aggregate queries showing patterns (distributions, trends, rankings)
   ✓ Comparisons between categories or segments (e.g., subscription by job type)
   ✓ Time series or temporal patterns (e.g., trends over months)
   ✓ Relationships between variables (e.g., age vs balance)
   ✓ Any query where a chart clarifies the insight better than numbers

   WHEN TO SKIP VISUALIZATION:
   ✗ Simple row lookups or filtering (SELECT * WHERE id = 123)
   ✗ Schema exploration or profiling queries
   ✗ Verification/sanity check queries (confirming totals)
   ✗ Single aggregate values (SELECT COUNT(*) FROM table)
   ✗ Queries with < 3 rows of results

   HOW TO VISUALIZE:
   - IMPORTANT: Pass the queryId from executeSQLQuery result (don't copy data manually!)
   - Example: executeSQLQuery returns queryId="123" → suggestViz({ queryId: "123", ... })
   - Choose appropriate chart type:
     * bar: Categories, distributions, rankings, comparisons
     * line: Time series, trends over time
     * scatter: Correlations between two variables
     * area: Cumulative trends over time
     * pie: Proportions (use sparingly)

   DECISION FRAMEWORK:
   Ask yourself: "Would a chart help the user understand this finding better than numbers alone?"
   If yes → create visualization. If no → skip and continue analysis.

3. **REFINE** - Iteratively explore through multi-step investigation

   PROACTIVE DRILL-DOWN PATTERNS (drive deeper automatically!):

   → When you see a SPIKE or OUTLIER in distribution:
     Example: "Age 18-25 has 58% rate (much higher than others)"
     Action: Query that specific segment to understand why

   → When one SEGMENT STANDS OUT:
     Example: "Students have 28.7% rate vs 11% overall"
     Action: Break down further - do young students differ from older ones?

   → When exploring ONE DIMENSION:
     Example: Analyzed age distribution
     Action: Also explore job, marital status, education (multi-dimensional)

   → When you find a PATTERN:
     Example: "Balance seems related to subscription"
     Action: Cross-analyze - does this hold across age groups? job types?

   → When making a HYPOTHESIS:
     Example: "Maybe contact duration matters"
     Action: Test it - query duration vs outcome

   FOLLOW THE "WHY?" CHAIN:
   - Initial finding → Ask "Why is this happening?" → Query deeper
   - Keep asking "What else affects this?" until pattern is clear
   - Use 5-8 tool calls for thorough exploration (don't stop at 2-3!)

   REACTIVE REFINEMENT (handle issues):
   - If query fails → analyze error and retry with corrected approach
   - If results empty → try broader filters or different angle
   - If unexpected → investigate with follow-up queries

   Remember: You have up to 10 tool calls - use them to deliver comprehensive insights!

4. **VALIDATE** - Ensure quality before responding
   - Use follow-up executeSQLQuery calls to verify key claims
   - Example: Claiming "Age 18 has 58% rate"? → Run targeted query to confirm
   - Cross-check aggregations: Do group totals = overall total?
   - Confirm specific percentages with focused queries
   - Review your findings for completeness
   - Verify visualizations support your conclusions

5. **SUMMARIZE** - Deliver concise, actionable insights
   - Provide BRIEF summary (2-3 sentences max) of KEY findings
   - Reference artifacts: "See the SQL tab" or "I've added a chart to the Charts tab"
   - Suggest natural next steps or follow-up questions

ANALYSIS PHILOSOPHY:
Structure analysis to answer:
- WHAT is happening? (descriptive - trends, patterns, distributions)
- WHY is it happening? (diagnostic - correlations, segmentation, comparisons)
- WHAT should be done? (prescriptive - opportunities, priorities, recommendations)

ITERATIVE REFINEMENT EXAMPLE (follow this pattern):
User asks: "What factors affect subscription rates?"

Step 1: executeSQLQuery("SELECT COUNT(*) as total, AVG(CASE WHEN y='yes' THEN 1 ELSE 0 END)*100 as rate FROM table")
→ Result: 45,211 records, 11.7% baseline rate
→ Decision: Good baseline, now explore dimensions

Step 2: executeSQLQuery("SELECT age, COUNT(*) as count, AVG(CASE WHEN y='yes' THEN 1 ELSE 0 END)*100 as rate FROM table GROUP BY age ORDER BY rate DESC")
→ Result: Age 18-25 shows 58% rate (SPIKE!) vs 11.7% baseline
→ suggestViz(queryId, bar chart)
→ Decision: Spike detected! Drill down into this segment

Step 3: executeSQLQuery("SELECT job, AVG(CASE WHEN y='yes' THEN 1 ELSE 0 END)*100 as rate FROM table WHERE age BETWEEN 18 AND 25 GROUP BY job")
→ Result: Students within 18-25 have 72% rate
→ suggestViz(queryId, bar chart)
→ Decision: Students are key driver, verify this finding

Step 4: executeSQLQuery("SELECT AVG(CASE WHEN y='yes' THEN 1 ELSE 0 END)*100 as rate FROM table WHERE job='student' AND age BETWEEN 18 AND 25", "Verify: Students aged 18-25 subscription rate")
→ Result: Confirmed 72.1% (matches drill-down finding)
→ Decision: Verified! Now explore other dimensions

Step 5: executeSQLQuery("SELECT marital, AVG(CASE WHEN y='yes' THEN 1 ELSE 0 END)*100 as rate FROM table GROUP BY marital")
→ Result: Single individuals have 14.3% vs 9.2% married
→ suggestViz(queryId, bar chart)
→ Decision: Another pattern, but less dramatic than age/job

Step 6: Summarize: "Key finding: Students aged 18-25 show the highest subscription rate at 72%, compared to 11.7% baseline. Singles also show elevated rates at 14.3%. See SQL tab for queries and Charts tab for visualizations."

This demonstrates: baseline → exploration → spike detection → drill-down → verification → multi-dimensional → summary

SELF-CORRECTION:
- If query fails → explain issue and retry with corrected query
- If results are empty → try broader filters or different approach
- If unexpected results → investigate with follow-up queries
- Never give up after one failed attempt

CRITICAL RULES:
✓ Use 5-8 tool calls for thorough questions (shallow = 2-3 calls, deep = 5-8 calls)
✓ Ask yourself "What else?" and "Why?" to drive deeper exploration
✓ When you find a spike or outlier → ALWAYS drill down to investigate
✓ Explore multiple dimensions (age, job, education, marital, etc.) not just one
✓ Verify key claims with targeted follow-up queries
✓ Create visualizations when they add insight (use judgment)
✓ Examine results before deciding next step
✓ Keep text responses BRIEF - let charts and SQL results do the talking
✗ Don't dump raw data in chat - store it in SQL/Charts tabs
✗ Don't stop after surface-level analysis - investigate patterns
✗ Don't present unverified claims - confirm statistics through queries

Be autonomous, thorough, and insight-driven. Use your full tool budget to deliver comprehensive analysis.`

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
