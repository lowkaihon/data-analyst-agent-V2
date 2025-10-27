import { openai } from "@ai-sdk/openai"
import { convertToModelMessages, streamText, tool, stepCountIs, generateText } from "ai"
import { z } from "zod"
import { getPostgresPool } from "@/lib/postgres"
import { guardSQL } from "@/lib/sql-guard"
import { createServerClient } from "@/lib/supabase/server"

export const maxDuration = 180

export async function POST(req: Request, { params }: { params: Promise<{ datasetId: string }> }) {
  try {
    console.log("Chat API route called")

    // Extract datasetId from route params
    const { datasetId } = await params
    console.log("DatasetId from route params:", datasetId)

    if (!datasetId) {
      console.log("Missing datasetId in route params")
      return new Response("Missing datasetId", { status: 400 })
    }

    const body = await req.json()
    console.log("Request body keys:", Object.keys(body))

    let messages = body.messages
    const mode = body.mode || "normal" // "normal" or "deep-dive"
    const isDeepDive = mode === "deep-dive"

    console.log("Chat mode:", mode)

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
      console.error("Dataset fetch error:", datasetError)
      return new Response("Dataset not found", { status: 404 })
    }

    console.log("Dataset found:", dataset.table_name)

    const isInitMessage =
      messages.length === 1 &&
      messages[0].role === "user" &&
      messages[0].parts?.some((p: any) => p.type === "text" && p.text === "__INIT__")

    if (isInitMessage) {
      console.log("Detected init message, replacing with greeting prompt")

      // Fetch schema information to provide upfront (avoid 17 SQL queries)
      const pool = getPostgresPool()
      const columnsQuery = `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name != 'id'
        ORDER BY ordinal_position
      `
      const columnsResult = await pool.query(columnsQuery, [dataset.table_name])

      // Format column info concisely
      const columnInfo = columnsResult.rows.map(col => {
        const type = col.data_type === 'integer' || col.data_type === 'double precision' || col.data_type === 'numeric'
          ? 'number'
          : col.data_type === 'boolean' ? 'boolean' : 'text'
        return `${col.column_name} (${type})`
      }).join(', ')

      // Replace __INIT__ with schema-enriched prompt
      const schemaInfo = `Dataset: ${dataset.row_count} rows, ${dataset.column_count} columns: ${columnInfo}`

      messages = [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: dataset.user_context
                ? `${schemaInfo}\n\nUser context: "${dataset.user_context}"\n\nVerify if structure matches context (1 sentence), then suggest 3 analytical questions to explore.`
                : `${schemaInfo}\n\nProvide a 1-sentence verification, then suggest 3 analytical questions I can explore.`,
            },
          ],
        },
      ]
    }

    // Deep-dive conversation reset: start fresh with only current message
    if (isDeepDive && !isInitMessage) {
      console.log("Deep-dive mode: resetting conversation context")

      // Fetch schema information for context
      const pool = getPostgresPool()
      const columnsQuery = `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name != 'id'
        ORDER BY ordinal_position
      `
      const columnsResult = await pool.query(columnsQuery, [dataset.table_name])

      // Format column info concisely
      const columnInfo = columnsResult.rows.map(col => {
        const type = col.data_type === 'integer' || col.data_type === 'double precision' || col.data_type === 'numeric'
          ? 'number'
          : col.data_type === 'boolean' ? 'boolean' : 'text'
        return `${col.column_name} (${type})`
      }).join(', ')

      const schemaInfo = `Dataset: ${dataset.row_count} rows, ${dataset.column_count} columns: ${columnInfo}`

      // Get current user message (last message in array)
      const currentMessage = messages[messages.length - 1]
      const userText = currentMessage.parts?.find((p: any) => p.type === "text")?.text || "Analyze this dataset comprehensively"

      // Reset to only current message with schema context prepended
      messages = [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: dataset.user_context
                ? `${schemaInfo}\n\nUser context: "${dataset.user_context}"\n\nUser request: ${userText}`
                : `${schemaInfo}\n\nUser request: ${userText}`
            }
          ]
        }
      ]

      console.log("Conversation reset complete. Starting fresh deep-dive analysis.")
    }

    const pool = getPostgresPool()

    const tools = {
      executeSQLQuery: tool({
        description: `Execute a SELECT query to explore data. Returns preview (5 rows), AI analysis of full results, and queryId for visualization.`,
        inputSchema: z.object({
          query: z.string().describe("SELECT query ending with LIMIT clause (max 1500). Example: 'SELECT x FROM t GROUP BY x LIMIT 100'. Never include trailing semicolons."),
          reasoning: z.string().describe("What insight this query reveals (1 sentence)"),
        }),
        execute: async ({ query, reasoning }) => {
          console.log("Executing SQL:", query)
          console.log("Reasoning:", reasoning)

          const startTime = Date.now()

          try {
            // Guard SQL to ensure it's SELECT-only and add LIMIT
            const guardedSQL = guardSQL(query, dataset.table_name, 1500)
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
              columns: result.fields.map((f: any) => f.name), // Store column order from PostgreSQL
            }).select('id').single()

            if (insertError) {
              console.error("Error inserting run:", insertError)
            }

            const queryId = runData?.id

            // Return preview (first 5 rows) instead of full dataset to save tokens
            const preview = result.rows.slice(0, 5)

            // Spawn sub-agent to analyze full results
            let analysis = null;

            // Only analyze if we have meaningful results (>0 rows)
            if (result.rowCount && result.rowCount > 0) {
              try {
                // Spawn analysis sub-agent with up to 100 rows
                const analysisResult = await generateText({
                  model: openai('gpt-4o-mini'), // Cost-effective model
                  system: `You are a data analysis expert. Analyze SQL query results and provide a 2-3 sentence summary covering:
1. Key patterns, trends, or distributions observed
2. Notable outliers, anomalies, or standout segments
3. Suggested dimensions to explore next (age, category, time periods, etc.)

Be concise, specific, and actionable.`,
                  prompt: `Query: ${guardedSQL}
Reasoning: ${reasoning}
Row count: ${result.rowCount}
Sample data (first ${Math.min(result.rowCount, 100)} rows):
${JSON.stringify(result.rows.slice(0, 100), null, 2)}

Provide 2-3 sentence analysis:`,
                  temperature: 0.3, // More deterministic
                });

                analysis = analysisResult.text;
                console.log('✅ Sub-agent analysis:', analysis);
              } catch (error) {
                console.error('⚠️ Sub-agent analysis failed:', error);
                // Gracefully continue without analysis
                analysis = null;
              }
            }

            return {
              success: true,
              queryId: queryId, // ID to reference this query's data
              rowCount: result.rowCount,
              preview: preview, // Small preview for AI to examine
              analysis: analysis, // NEW: Full-dataset insights from sub-agent
              reasoning,
            }
          } catch (error: any) {
            console.error("SQL execution error:", error)
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
              analysis: null,
              note: "Failed queries count toward your step budget. Don't retry more than once.",
            }
          }
        },
      }),

      createChart: tool({
        description: `Create Vega-Lite chart from query results. Use queryId from executeSQLQuery.`,
        inputSchema: z.object({
          queryId: z.string().describe("QueryId from executeSQLQuery"),
          chartType: z.enum(["bar", "line", "scatter", "area", "pie"]).describe("bar: categories/rankings, line: ordered/time-series, scatter: correlations, area: cumulative, pie: proportions (3-5 categories only)"),
          xField: z.string().describe("Column for x-axis (must exist in query results)"),
          yField: z.string().describe("Column for y-axis (must exist in query results)"),
          title: z.string().describe("Descriptive title explaining the insight"),
          xAxisLabel: z.string().optional().describe("Custom x-axis label (default: xField name)"),
          yAxisLabel: z.string().optional().describe("Custom y-axis label (default: yField name)"),
        }),
        execute: async ({ queryId, chartType, xField, yField, title, xAxisLabel, yAxisLabel }) => {
          console.log("Generating chart:", chartType, "for queryId:", queryId)

          // Fetch data from runs table using queryId
          const supabaseClient = await createServerClient()
          const { data: runData, error: fetchError } = await supabaseClient
            .from("runs")
            .select("sample")
            .eq("id", queryId)
            .single()

          if (fetchError || !runData) {
            console.error("Error fetching query data:", fetchError)
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

          console.log("Fetched", data.length, "rows for visualization")

          // Use shared configuration for consistency
          const { VEGA_BASE_CONFIG, CHART_CONSTRAINTS } = await import("@/lib/vega-config")

          // Validate data volume
          if (data.length > CHART_CONSTRAINTS.MAX_DATA_POINTS) {
            return {
              success: false,
              error: `Dataset too large (${data.length} points). Maximum is ${CHART_CONSTRAINTS.MAX_DATA_POINTS}. Consider aggregating data first.`,
            }
          }

          // Determine field types (simple heuristic)
          const sampleValue = data[0]?.[xField]
          const isXTemporal = !isNaN(Date.parse(sampleValue))
          const xType = isXTemporal ? "temporal" : typeof sampleValue === "number" ? "quantitative" : "nominal"

          // Base spec with accessibility and data handling best practices
          let spec: any = {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            title,
            description: title, // For ARIA labels and screen readers
            width: CHART_CONSTRAINTS.DEFAULT_WIDTH,
            height: CHART_CONSTRAINTS.DEFAULT_HEIGHT,
            data: { values: data },
            config: VEGA_BASE_CONFIG,
          }

          // Chart-specific configurations with invalid data handling
          if (chartType === "bar") {
            spec.mark = {
              type: "bar",
              cornerRadiusEnd: 4,
              tooltip: true,
              invalid: "filter", // Exclude null/NaN values
            }
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
          } else if (chartType === "line") {
            spec.mark = {
              type: "line",
              point: true,
              tooltip: true,
              strokeWidth: 2,
              invalid: "break-paths-show-domains", // Break line at nulls but keep in scale
            }
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
            spec.mark = {
              type: "circle",
              size: 80,
              opacity: 0.7,
              tooltip: true,
              invalid: "filter", // Exclude null/NaN values
            }
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
            spec.mark = {
              type: "area",
              line: true,
              point: false,
              tooltip: true,
              invalid: "break-paths-show-domains", // Break area at nulls but keep in scale
            }
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
            spec.mark = {
              type: "arc",
              tooltip: true,
              invalid: "filter", // Exclude null/NaN values
            }
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

    // Engineered the AI prompt based on GPT-5-mini (low reasoning) best practices
    const deepDiveSystemPrompt = `<role>
Data analyst performing comprehensive analysis.${dataset.user_context ? `
Context: "${dataset.user_context}"` : ''}
</role>

<dataset>
Table: \`${dataset.table_name}\`
Rows: ${dataset.row_count}, Columns: ${dataset.column_count}
</dataset>

<task>
Perform thorough analysis using SQL queries and visualizations. Explore major dimensions, patterns, outliers, and feature interactions. Validate key findings. Deliver 3-5 actionable insights with strong evidence.

Step budget: You have 30 steps available. Typical comprehensive analysis uses 20-30 steps. Be thorough - this is deep-dive mode, not quick Q&A. One step may include parallel tool calls (e.g., executeSQLQuery + createChart simultaneously).

IMPORTANT: You are starting fresh with this deep-dive analysis. Previous chat history is not available. The user has provided all necessary context in their request above. Focus on the dataset and user's stated objectives.
</task>

<tools>
executeSQLQuery: Execute SELECT query. Returns {success, queryId, rowCount, preview, analysis}. Use 'analysis' field for insights from full results.

createChart: Create visualization from queryId. Types: bar (categories), line (time series), scatter (correlations), area (cumulative), pie (3-5 proportions). Create 5-7 high-impact charts for major distributions and key patterns.
</tools>

<sql_rules>
PostgreSQL dialect - SELECT only against \`${dataset.table_name}\`:

1. For derived fields (CASE), use CTE named 'base', then SELECT from base. GROUP BY alias names or ordinals.
2. Without CTE, use ordinal grouping: GROUP BY 1,2,3 matching SELECT order.
3. Alias scope: SELECT aliases are valid in ORDER BY, not in WHERE/GROUP BY/HAVING. Use a CTE or ordinals (GROUP BY 1,2) instead.
4. Always end with LIMIT ≤ 1500. No semicolons.
5. String concat: || operator. Dates: DATE_TRUNC(), EXTRACT(). Conditional aggs: FILTER (WHERE ...).
6. Rates: AVG(CASE WHEN condition THEN 1.0 ELSE 0.0 END). Avoid divide-by-zero with NULLIF.
7. Quote reserved columns: "default", "user", "order", etc., or alias them in a base CTE (SELECT "default" AS is_default).
8. WHERE = row filters before aggregation. HAVING = filters on aggregated results.
9. Custom sort: Add order column in base, or use ARRAY_POSITION(ARRAY['A','B'], col).
10. Time series: DATE_TRUNC(...) AS period in base, GROUP BY 1, ORDER BY 1.
11. Booleans: treat y as boolean. Use CASE WHEN y THEN 1.0 ELSE 0.0 END (or y IS TRUE). Never compare y to numbers or strings and never use IN (...) with mixed types.
12. Don't use ORDER BY inside CTEs unless paired with LIMIT; order at the outermost SELECT.
</sql_rules>

<output_format>
Structure response with TWO sections:

=== EXECUTIVE SUMMARY ===
[3-5 key insights in max 10 sentences with evidence inline]

See Charts tab for visualizations and SQL tab for detailed queries.

You might also explore:
1. [Follow-up question]
2. [Follow-up question]
3. [Follow-up question]

=== DETAILED ANALYSIS ===

Key Findings:
[Numbered list with evidence, metrics, sample sizes]

Validation Performed:
[Numbered list of checks run and results]

Hypothesis Tests & Segment Drills:
[Numbered list of tests performed and findings]

Standout Segments:
[Numbered list of segments with size and key metrics]

Limitations & Data Quality:
[Numbered list of caveats and data issues]

Constraints:
• Plain text only (no markdown, code blocks, tables)
• Use numbered lists with periods
• Use exact section headers
• Stop after Limitations section - no additional recommendations or sections
</output_format>`

    // Normal Mode
    // Engineered the AI prompt based on GPT-4o best practices
    const systemPrompt = `# ROLE & MISSION

You are a specialized data analyst for structured datasets. Your scope is strictly limited to:
- Answering specific user questions using SQL queries against the provided dataset
- Creating visualizations when data patterns benefit from visual representation
- Providing evidence-based, concise responses${dataset.user_context ? `

Dataset Context: "${dataset.user_context}"` : ''}

# REASONING PROTOCOL

Perform all query planning, reasoning, and reflection internally. Only display final answers, SQL execution results, and visualizations. Never expose intermediate logic, thought processes, or decision-making steps.

# DATASET SPECIFICATION

Table: \`${dataset.table_name}\`
Rows: ${dataset.row_count}
Columns: ${dataset.column_count}

# BEHAVIORAL INVARIANTS

These patterns must remain consistent across all responses:

1. **Scope Discipline**: Respond only to the specific question asked. Do not explore adjacent topics, validate with additional queries, or perform comprehensive analysis unless explicitly requested.

2. **Tool Usage**: Execute SQL via executeSQLQuery. Create visualizations via createChart for datasets with 5+ rows showing visual patterns.

3. **Evidence Requirement**: Every answer must include concrete evidence from query results.

4. **Output Structure**: Always follow the prescribed output format (see OUTPUT FORMAT section).

5. **Completion Signal**: After answering the user's question, stop. Wait for the next user question.

# INITIAL RESPONSE PROTOCOL

When user message contains only schema information (column names, types, row counts):
1. Acknowledge dataset structure in one sentence
2. State: "Here are some analytical questions to explore:"
3. Provide three numbered analytical questions
4. STOP - make no tool calls, add no additional text

# OPERATIONAL RULES

## Workflow
1. Parse the user's specific question
2. Execute minimum SQL queries required to answer completely
3. Create visualizations if data is visual (5+ rows, clear patterns)
4. State direct answer with supporting evidence
5. STOP - await next user question

## Query Scope Policy
- **Single-part questions**: Use one query unless technically impossible
- **Multi-part questions** (e.g., "Compare X vs Y", "Show A and B"): Use multiple queries as needed
- **Scope boundary**: Answer exactly what was asked. Do not:
  - Explore periods, segments, or dimensions not mentioned
  - Validate results with confirmation queries
  - Drill into patterns unless specifically requested
  - Perform exploratory or comprehensive analysis

## Completion Criteria
Response is complete when:
□ User's specific question is fully answered
□ Evidence from query results is provided
□ Appropriate visualizations are created
□ Two follow-up questions are suggested
□ Artifacts reference is included

Before sending, verify: no exploration beyond the question, no validation queries, no unsolicited deep-dives.

# TOOL SPECIFICATIONS

**executeSQLQuery**
- Purpose: Execute SELECT query against dataset
- Returns: {success, queryId, rowCount, preview, analysis}
- Usage: Reference the 'analysis' field for insights from full result set

**createChart**
- Purpose: Generate visualization from queryId
- Types:
  - bar: Categorical comparisons
  - line: Time series trends
  - scatter: Correlation analysis
  - area: Cumulative patterns
  - pie: Proportional splits (3-5 segments)
- Usage: Apply when data has visual structure

# SQL TECHNICAL CONSTRAINTS

PostgreSQL dialect - SELECT only against \`${dataset.table_name}\`:

1. **Derived Fields**: Use CTE named 'base' for CASE expressions, then SELECT from base. GROUP BY alias names or ordinals.
2. **Ordinal Grouping**: Without CTE, use GROUP BY 1,2,3 matching SELECT column order.
3. **Alias Scope**: SELECT aliases are valid in ORDER BY only, not in WHERE/GROUP BY/HAVING. Use CTE or ordinals (GROUP BY 1,2) instead.
4. **Query Limits**: Always end with LIMIT ≤ 1500. Never use semicolons.
5. **Functions**: String concat (|| operator), dates (DATE_TRUNC, EXTRACT), conditional aggregations (FILTER WHERE).
6. **Rate Calculations**: Use AVG(CASE WHEN condition THEN 1.0 ELSE 0.0 END). Prevent divide-by-zero with NULLIF.
7. **Reserved Words**: Quote reserved columns ("default", "user", "order") or alias in base CTE (SELECT "default" AS is_default).
8. **Filter Hierarchy**: WHERE = row filters before aggregation; HAVING = filters on aggregated results.
9. **Custom Sort**: Add order column in base CTE, or use ARRAY_POSITION(ARRAY['A','B'], col).
10. **Time Series**: Use DATE_TRUNC(...) AS period in base, GROUP BY 1, ORDER BY 1.
11. **Boolean Handling**: Treat boolean columns as boolean. Use CASE WHEN bool_col THEN 1.0 ELSE 0.0 END or bool_col IS TRUE. Never compare booleans to numbers/strings or use IN (...) with mixed types.
12. **CTE Ordering**: Do not use ORDER BY inside CTEs unless paired with LIMIT. Apply ordering at outermost SELECT.

# OUTPUT FORMAT

Structure every analysis response as:

[Direct answer to user's question in 1-2 sentences with key evidence]

See Charts tab for visualizations and SQL tab for detailed queries.

You might also ask:
1. [Clarifying question about their specific goal]
2. [Follow-up question on this specific dimension]

## Output Constraints
- Plain text only (no markdown, code blocks, tables)
- Use numbered lists with periods
- Be direct and concise
- Always include artifacts reference and exactly 2 follow-up questions

# STYLE & TONE

- **Voice**: Direct, evidence-based, analytical
- **Brevity**: 1-2 sentence answers with concrete evidence
- **Precision**: Reference specific numbers, categories, or patterns from query results
- **Restraint**: Answer only what was asked; do not narrate your process or explain your reasoning`

    console.log("Starting streamText with", messages.length, "messages", isDeepDive ? "(DEEP DIVE MODE)" : "(NORMAL MODE)")

    const result = streamText({
      model: openai(isDeepDive ? "gpt-5-mini" : "gpt-4o"),
      system: isDeepDive ? deepDiveSystemPrompt : systemPrompt,
      messages: convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(isDeepDive ? 40 : 10),  // Deep dive: comprehensive analysis (30 steps + 10 buffer). Normal: responsive Q&A (10 steps).
      // Only apply reasoningEffort for reasoning models
      providerOptions: {
        openai: {
          reasoningEffort: 'low'
        }
      },
      onStepFinish: ({ toolCalls, toolResults }) => {
        console.log("Step finished", isDeepDive ? `(Deep Dive)` : "")
        if (toolCalls) {
          console.log(
            "Tool calls:",
            toolCalls.map((tc) => tc.toolName),
          )
        }
      },
      onFinish: async ({ text, finishReason }) => {
        // Capture AI response for report generation (especially valuable for deep-dive mode)
        if (text && text.trim().length > 0) {
          console.log("Capturing AI response for report generation:", text.substring(0, 100) + "...")

          try {
            const supabaseFinish = await createServerClient()

            // Store the AI response as an analysis_summary run
            await supabaseFinish.from("runs").insert({
              dataset_id: datasetId,
              type: "analysis_summary",
              status: "success",
              ai_response: text,
              insight: isDeepDive ? "Deep-dive analysis summary" : "Analysis summary",
            })

            console.log("AI response stored successfully")
          } catch (error) {
            console.error("Failed to store AI response:", error)
            // Don't throw - we don't want to break the response stream
          }
        }
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (error: any) {
    console.error("Chat API error:", error)
    return new Response(error.message || "Internal server error", {
      status: 500,
    })
  }
}
