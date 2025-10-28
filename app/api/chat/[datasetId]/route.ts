import { openai } from "@ai-sdk/openai"
import { convertToModelMessages, streamText, tool, stepCountIs, generateText } from "ai"
import { z } from "zod"
import { getPostgresPool } from "@/lib/postgres"
import { guardSQL } from "@/lib/sql-guard"
import { createServerClient } from "@/lib/supabase/server"

export const maxDuration = 300

// Query timeout constants
const QUERY_TIMEOUT_NORMAL_MS = 30000 // 30 seconds
const QUERY_TIMEOUT_DEEP_DIVE_MS = 60000 // 60 seconds

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

            // Apply timeout based on mode
            const queryTimeout = isDeepDive ? QUERY_TIMEOUT_DEEP_DIVE_MS : QUERY_TIMEOUT_NORMAL_MS
            const queryPromise = pool.query(guardedSQL)
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Query timeout after ${queryTimeout / 1000}s. Try simplifying the query or reducing the data range.`)), queryTimeout)
            )

            const result = await Promise.race([queryPromise, timeoutPromise])
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
                  // Engineered the AI prompt based on GPT-4o-mini best practices
                  system: `You are a data analysis expert specializing in SQL query result interpretation.

# Task
Analyze the provided SQL query results (limited to 100 rows) and provide a concise summary using this exact structure:

**Key Findings:** [1 sentence describing the primary pattern, trend, or distribution in the data]
**Notable Observations:** [1 sentence highlighting significant outliers, anomalies, or standout segments]
**Recommended Exploration:** [1 sentence suggesting specific dimensions or filters to investigate next]

# Rules
- Base your analysis only on patterns actually present in the data
- Include specific numbers or percentages when relevant (e.g., "65% of transactions...")
- Keep each section under 25 words
- If the sample size is too small for reliable conclusions, state this limitation
- Do not speculate beyond what the data shows
`,
                  prompt: `Query: ${guardedSQL}
Reasoning: ${reasoning}
Row count: ${result.rowCount}

<sql_results>
${JSON.stringify(result.rows.slice(0, 100), null, 2)}
</sql_results>

Analyze the above SQL results according to the system instructions.
Format your response with:
**Key Findings:** ...
**Notable Observations:** ...
**Recommended Exploration:** ...
`,
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
        description: `Create Vega-Lite chart from query results. Automatically fetches optimal data amount based on chart type. Use queryId from executeSQLQuery.`,
        inputSchema: z.object({
          queryId: z.string().describe("QueryId from executeSQLQuery"),
          chartType: z.enum(["bar", "line", "scatter", "area", "pie", "boxplot", "heatmap"]).describe("bar: categorical x + quantitative y (comparisons), line: temporal/ordered x + quantitative y (trends), scatter: quantitative x + quantitative y (correlations), area: temporal x + quantitative y (cumulative), pie: categorical (3-7 categories), boxplot: categorical x + quantitative y (distributions) - REQUIRES raw unaggregated data with 3+ points per category; for pre-aggregated data (AVG/SUM/COUNT) use bar chart, heatmap: categorical x + categorical y + quantitative z (2D patterns) - REQUIRES aggregated data (one row per x,y combination via GROUP BY x, y)"),
          xField: z.string().describe("Column for x-axis (must exist in query results)"),
          yField: z.string().describe("Column for y-axis (must exist in query results)"),
          title: z.string().describe("Descriptive title explaining the insight"),
          subtitle: z.string().optional().describe("Optional subtitle for additional context"),
          xAxisLabel: z.string().optional().describe("Custom x-axis label (default: xField name)"),
          yAxisLabel: z.string().optional().describe("Custom y-axis label (default: yField name)"),
          colorField: z.string().optional().describe("Optional field to color by (categorical for bar/line/scatter/area; quantitative value field for heatmap; not used for pie/boxplot)"),
        }),
        execute: async ({ queryId, chartType, xField, yField, title, subtitle, xAxisLabel, yAxisLabel, colorField }) => {
          console.log("Generating chart:", chartType, "for queryId:", queryId)

          // Fetch original SQL from runs table
          const supabaseClient = await createServerClient()
          const { data: runData, error: fetchError } = await supabaseClient
            .from("runs")
            .select("sql, columns")
            .eq("id", queryId)
            .single()

          if (fetchError || !runData) {
            console.error("Error fetching query data:", fetchError)
            return {
              success: false,
              error: "Failed to fetch query data for visualization",
            }
          }

          const sqlQuery = runData.sql as string
          const columns = runData.columns as string[]

          // Determine chart-type-specific limit for optimal visualization
          const chartLimit = chartType === "boxplot" ? 10000
                           : ["scatter", "line", "area"].includes(chartType) ? 5000
                           : 1500 // bar, pie, heatmap (aggregated data)

          console.log(`Re-querying with ${chartLimit} row limit for ${chartType} chart`)

          // Check actual row count to determine if we need special handling
          // Build a COUNT query by wrapping the original SQL
          const countSQL = `SELECT COUNT(*) FROM (${sqlQuery.replace(/;?\s*$/, '')}) as subquery`
          const countResult = await pool.query(countSQL)
          const totalRows = Number.parseInt(countResult.rows[0].count, 10)

          console.log(`Query would return ${totalRows} rows (chart limit: ${chartLimit})`)

          // Track whether we're using aggregate data (for boxplot spec building)
          let useAggregates = false
          let data: any[]

          // Handle large datasets based on chart type
          if (totalRows > chartLimit) {
            if (chartType === "boxplot") {
              // ✅ Auto-fix: Use SQL statistical aggregates for accurate distribution
              console.log(`Using SQL aggregates for boxplot (${totalRows} rows exceeds ${chartLimit} limit)`)

              const { convertToStatsQuery, canConvertToStats } = await import("@/lib/sql-stats")

              if (!canConvertToStats(sqlQuery)) {
                return {
                  success: false,
                  error: "Cannot create boxplot: query contains aggregation or complex features. Please use a simple SELECT query with raw data.",
                }
              }

              const statsSQL = convertToStatsQuery(sqlQuery, xField, yField)
              console.log("Generated stats query:", statsSQL)

              const startTime = Date.now()
              const statsResult = await pool.query(statsSQL)
              const durationMs = Date.now() - startTime

              data = statsResult.rows
              useAggregates = true

              if (!data || data.length === 0) {
                return {
                  success: false,
                  error: "No data available to visualize",
                }
              }

              console.log(`Fetched ${data.length} category statistics for boxplot (from ${totalRows} original rows)`)
            } else {
              // ❌ Reject: Force LLM to aggregate for other chart types
              return {
                success: false,
                error: `Query would return ${totalRows} rows but ${chartType} charts are limited to ${chartLimit} points for readability. Please aggregate the data using SQL (e.g., GROUP BY with AVG/SUM/COUNT, bin temporal data into larger intervals, or use a different chart type like boxplot for distributions).`,
              }
            }
          } else {
            // Dataset is small enough, use standard approach
            const guardedSQL = guardSQL(sqlQuery, dataset.table_name, chartLimit)

            const startTime = Date.now()
            const queryResult = await pool.query(guardedSQL)
            const durationMs = Date.now() - startTime

            data = queryResult.rows

            if (!data || data.length === 0) {
              return {
                success: false,
                error: "No data available to visualize",
              }
            }

            console.log("Fetched", data.length, "rows for visualization (limit:", chartLimit, ")")
          }

          // Use shared configuration for consistency
          const { VEGA_BASE_CONFIG, CHART_CONSTRAINTS } = await import("@/lib/vega-config")

          // Validate data volume
          if (data.length > CHART_CONSTRAINTS.MAX_DATA_POINTS) {
            return {
              success: false,
              error: `Dataset too large (${data.length} points). Maximum is ${CHART_CONSTRAINTS.MAX_DATA_POINTS}. Consider aggregating data first.`,
            }
          }

          // Determine field types with enhanced discrete integer detection
          const sampleValue = data[0]?.[xField]
          // Stricter temporal detection: must be string-like date format, not bare integers
          // Prevents integers (1, 2, 3...) from being treated as timestamps
          const isXTemporal = typeof sampleValue === "string"
                             && !isNaN(Date.parse(sampleValue))
                             && isNaN(Number(sampleValue))

          // Enhanced type detection for x-axis: distinguish discrete integer sequences from continuous numeric data
          let xType: string
          if (isXTemporal) {
            xType = "temporal"
          } else if (typeof sampleValue === "number") {
            // Check if this is a discrete integer sequence (like buckets 1-10, ratings 1-5, etc.)
            const uniqueXValues = new Set(data.map(d => d[xField]))
            const isAllIntegers = Array.from(uniqueXValues).every(v => typeof v === 'number' && Number.isInteger(v))
            const isDiscrete = uniqueXValues.size <= 20 && isAllIntegers

            // Use ordinal for discrete integer sequences (ensures all labels show), quantitative for continuous
            xType = isDiscrete ? "ordinal" : "quantitative"
          } else {
            xType = "nominal"
          }

          // Analyze y-values to determine optimal format (for rates vs counts)
          const yValues = data.map(d => d[yField]).filter(v => typeof v === 'number' && !isNaN(v))
          const maxYValue = yValues.length > 0 ? Math.max(...yValues) : 1

          // Use 2 decimal places for rates/percentages (0-2 range), integers for larger values
          const yAxisFormat = (maxYValue < 2 && maxYValue > 0) ? ",.2f" : ",.0f"
          const tooltipFormat = yAxisFormat

          // Base spec with accessibility and data handling best practices
          let spec: any = {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            description: `${title}. ${chartType} chart showing ${yAxisLabel || yField} by ${xAxisLabel || xField}`, // Enhanced screen reader description
            width: "container" as any, // Responsive to zoom and resize
            height: CHART_CONSTRAINTS.DEFAULT_HEIGHT,
            autosize: {
              type: "fit" as const,
              contains: "padding" as const,
            },
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
              ...(data.length > 20 && { discreteBandSize: 25 }), // Thinner bars for many categories
            }
            spec.encoding = {
              x: {
                field: xField,
                type: xType,
                axis: {
                  title: xAxisLabel || xField,
                  labelAngle: xType === "nominal" && data.length > 8 ? -45 : 0,
                  labelOverlap: "greedy",
                  labelPadding: 5,
                  labelLimit: 100,
                },
              },
              y: {
                field: yField,
                type: "quantitative",
                axis: {
                  format: yAxisFormat,
                  title: yAxisLabel || yField,
                },
              },
              ...(colorField ? {
                color: {
                  field: colorField,
                  type: "nominal",
                  scale: { scheme: "tableau10" },
                  legend: {
                    title: colorField,
                    titleFontSize: 12,
                    labelFontSize: 11,
                    labelLimit: 150,
                    symbolSize: 100,
                  },
                },
              } : {
                color: { value: "#1f77b4" }, // Tableau10 blue - colorblind-safe
              }),
              tooltip: [
                { field: xField, type: xType, title: xAxisLabel || xField, ...(isXTemporal && { format: "%B %d, %Y" }) },
                { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
                ...(colorField ? [{ field: colorField, type: "nominal", title: colorField }] : []),
              ],
            }
          } else if (chartType === "line") {
            // Determine x-axis label angle based on data density
            const uniqueXCount = new Set(data.map(d => d[xField])).size
            const xLabelAngle = uniqueXCount > 10 ? -45 : 0

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
                axis: {
                  title: xAxisLabel || xField,
                  labelAngle: xLabelAngle,
                  labelOverlap: "greedy" as const, // Prevent label overlap
                  labelPadding: 5,
                  labelLimit: 100,
                },
              },
              y: {
                field: yField,
                type: "quantitative",
                axis: { format: yAxisFormat, title: yAxisLabel || yField },
              },
              // Optional color encoding by field
              ...(colorField ? {
                color: {
                  field: colorField,
                  type: "nominal" as const,
                  scale: { scheme: "tableau10" }, // Colorblind-safe palette
                  legend: { title: colorField },
                },
              } : {
                color: { value: "#1f77b4" }, // Tableau10 blue - colorblind-safe
              }),
              tooltip: [
                { field: xField, type: xType, title: xAxisLabel || xField, ...(isXTemporal && { format: "%B %d, %Y" }) },
                { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
                ...(colorField ? [{ field: colorField, type: "nominal", title: colorField }] : []),
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
                axis: {
                  format: yAxisFormat,
                  title: xAxisLabel || xField,
                  labelOverlap: "greedy" as const,
                  labelPadding: 5,
                  labelLimit: 100,
                },
              },
              y: {
                field: yField,
                type: "quantitative",
                axis: {
                  format: yAxisFormat,
                  title: yAxisLabel || yField,
                  labelOverlap: "greedy" as const,
                  labelPadding: 5,
                  labelLimit: 100,
                },
              },
              // Optional color encoding by field
              ...(colorField ? {
                color: {
                  field: colorField,
                  type: "nominal" as const,
                  scale: { scheme: "tableau10" }, // Colorblind-safe palette
                  legend: { title: colorField },
                },
              } : {
                color: { value: "#1f77b4" }, // Tableau10 blue - colorblind-safe
              }),
              tooltip: [
                { field: xField, type: "quantitative", title: xAxisLabel || xField, format: tooltipFormat },
                { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
                ...(colorField ? [{ field: colorField, type: "nominal", title: colorField }] : []),
              ],
            }
          } else if (chartType === "area") {
            // Determine x-axis label angle based on data density
            const uniqueXCount = new Set(data.map(d => d[xField])).size
            const xLabelAngle = uniqueXCount > 10 ? -45 : 0

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
                axis: {
                  title: xAxisLabel || xField,
                  labelAngle: xLabelAngle,
                  labelOverlap: "greedy" as const, // Prevent label overlap
                  labelPadding: 5,
                  labelLimit: 100,
                },
              },
              y: {
                field: yField,
                type: "quantitative",
                axis: { format: yAxisFormat, title: yAxisLabel || yField },
              },
              // Optional color encoding by field
              ...(colorField ? {
                color: {
                  field: colorField,
                  type: "nominal" as const,
                  scale: { scheme: "tableau10" }, // Colorblind-safe palette
                  legend: { title: colorField },
                },
              } : {
                color: { value: "#1f77b4" }, // Tableau10 blue - colorblind-safe
              }),
              tooltip: [
                { field: xField, type: xType, title: xAxisLabel || xField, ...(isXTemporal && { format: "%B %d, %Y" }) },
                { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
                ...(colorField ? [{ field: colorField, type: "nominal", title: colorField }] : []),
              ],
            }
          } else if (chartType === "pie") {
            // Validate category count (pie charts with >10 slices are hard to read)
            const uniqueCategories = new Set(data.map(d => d[xField])).size
            if (uniqueCategories > 10) {
              console.warn(`⚠️  Pie chart has ${uniqueCategories} categories. Consider using a bar chart for better readability.`)
            }

            spec.mark = {
              type: "arc",
              tooltip: true,
              invalid: "filter", // Exclude null/NaN values
              innerRadius: 0, // Use 50 for donut chart
              outerRadius: 120,
            }
            spec.encoding = {
              theta: {
                field: yField,
                type: "quantitative",
                stack: true,
              },
              color: {
                field: xField,
                type: "nominal",
                scale: { scheme: "tableau10" }, // Colorblind-safe palette
                legend: {
                  title: xAxisLabel || xField,
                  orient: "right",
                  labelLimit: 150,
                },
              },
              tooltip: [
                { field: xField, type: "nominal", title: xAxisLabel || xField },
                { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
              ],
            }
            spec.view = { stroke: null }
          } else if (chartType === "boxplot") {
            // Validate: box plots need categorical x and quantitative y
            const sampleXValue = data[0]?.[xField]
            const isXCategorical = typeof sampleXValue === "string" || (typeof sampleXValue === "number" && Number.isInteger(sampleXValue))

            if (!isXCategorical) {
              console.warn(`⚠️  Box plot requires categorical x-axis. Consider using scatter plot instead.`)
            }

            if (useAggregates) {
              // Aggregate mode: Build boxplot from pre-computed statistics
              // Data format: {xField, min, q1, median, q3, max, count}
              console.log("Building boxplot from aggregate statistics")

              const uniqueCategories = data.length
              const xLabelAngle = uniqueCategories > 10 ? -45 : 0

              // Use layer composition to build boxplot from aggregated data
              spec.layer = [
                // Whiskers (min to max range)
                {
                  mark: { type: "rule", size: 1 },
                  encoding: {
                    x: {
                      field: xField,
                      type: "nominal",
                      axis: {
                        title: xAxisLabel || xField,
                        labelAngle: xLabelAngle,
                        labelOverlap: "greedy" as const,
                        labelPadding: 5,
                        labelLimit: 100,
                      },
                    },
                    y: {
                      field: "min",
                      type: "quantitative",
                      scale: { zero: false },
                      axis: {
                        format: yAxisFormat,
                        title: yAxisLabel || yField,
                      },
                    },
                    y2: { field: "max" },
                  },
                },
                // Box (q1 to q3 IQR)
                {
                  mark: {
                    type: "bar",
                    size: uniqueCategories > 20 ? 10 : uniqueCategories > 10 ? 20 : 40,
                  },
                  encoding: {
                    x: {
                      field: xField,
                      type: "nominal",
                    },
                    y: { field: "q1", type: "quantitative" },
                    y2: { field: "q3" },
                    color: {
                      field: xField,
                      type: "nominal",
                      scale: { scheme: "tableau10" },
                      legend: null,
                    },
                  },
                },
                // Median line
                {
                  mark: { type: "tick", color: "white", size: uniqueCategories > 20 ? 10 : uniqueCategories > 10 ? 20 : 40 },
                  encoding: {
                    x: {
                      field: xField,
                      type: "nominal",
                    },
                    y: { field: "median", type: "quantitative" },
                  },
                },
              ]

              // Add tooltip layer for interactivity
              spec.layer.push({
                mark: { type: "bar", size: uniqueCategories > 20 ? 10 : uniqueCategories > 10 ? 20 : 40, opacity: 0 },
                encoding: {
                  x: { field: xField, type: "nominal" },
                  y: { field: "q1", type: "quantitative" },
                  y2: { field: "q3" },
                  tooltip: [
                    { field: xField, type: "nominal", title: xAxisLabel || xField },
                    { field: "min", type: "quantitative", title: `Min ${yAxisLabel || yField}`, format: tooltipFormat },
                    { field: "q1", type: "quantitative", title: `Q1 ${yAxisLabel || yField}`, format: tooltipFormat },
                    { field: "median", type: "quantitative", title: `Median ${yAxisLabel || yField}`, format: tooltipFormat },
                    { field: "q3", type: "quantitative", title: `Q3 ${yAxisLabel || yField}`, format: tooltipFormat },
                    { field: "max", type: "quantitative", title: `Max ${yAxisLabel || yField}`, format: tooltipFormat },
                    { field: "count", type: "quantitative", title: "Count", format: ",.0f" },
                  ],
                },
              })
            } else {
              // Raw data mode: Let Vega-Lite compute statistics
              // Validate: box plots need multiple raw data points per category (not aggregated data)
              const pointsPerCategory = new Map<any, number>()
              data.forEach(d => {
                const cat = d[xField]
                pointsPerCategory.set(cat, (pointsPerCategory.get(cat) || 0) + 1)
              })

              const minPointsPerCategory = Math.min(...Array.from(pointsPerCategory.values()))

              if (minPointsPerCategory < 3) {
                return {
                  success: false,
                  error: `Boxplot requires multiple raw data points per category (found ${minPointsPerCategory} point${minPointsPerCategory === 1 ? '' : 's'} per category). Your data appears to be pre-aggregated (e.g., using AVG, COUNT, SUM). Use a bar chart to compare aggregated values across categories instead.`
                }
              }

              // Determine x-axis label angle based on number of categories
              const uniqueCategories = new Set(data.map(d => d[xField])).size
              const xLabelAngle = uniqueCategories > 10 ? -45 : 0

              spec.mark = {
                type: "boxplot",
                extent: "min-max", // Show full range including outliers
                size: uniqueCategories > 20 ? 10 : uniqueCategories > 10 ? 20 : 40, // Adaptive box width
                tooltip: true,
                invalid: "filter", // Exclude null/NaN values
              }
              spec.encoding = {
                x: {
                  field: xField,
                  type: "nominal",
                  axis: {
                    title: xAxisLabel || xField,
                    labelAngle: xLabelAngle,
                    labelOverlap: "greedy" as const,
                    labelPadding: 5,
                    labelLimit: 100,
                  },
                },
                y: {
                  field: yField,
                  type: "quantitative",
                  axis: {
                    format: yAxisFormat,
                    title: yAxisLabel || yField,
                  },
                  scale: {
                    zero: false, // Don't force zero baseline for better distribution visibility
                  },
                },
                color: {
                  field: xField,
                  type: "nominal",
                  scale: { scheme: "tableau10" }, // Colorblind-safe palette
                  legend: null, // Hide legend (redundant with x-axis)
                },
                tooltip: [
                  { field: xField, type: "nominal", title: xAxisLabel || xField },
                  { field: yField, type: "quantitative", title: `${yAxisLabel || yField} (Range)`, format: tooltipFormat },
                ],
              }
            }
          } else if (chartType === "heatmap") {
            // Validate: heatmap needs categorical x, categorical y, and a quantitative value field
            // Requires aggregated data (one row per x,y combination)
            const sampleXValue = data[0]?.[xField]
            const sampleYValue = data[0]?.[yField]

            const isXCategorical = typeof sampleXValue === "string" || typeof sampleXValue === "number"
            const isYCategorical = typeof sampleYValue === "string" || typeof sampleYValue === "number"

            if (!isXCategorical || !isYCategorical) {
              console.warn(`⚠️  Heatmap requires categorical x and y axes.`)
            }

            // Determine the value field for color encoding
            // If colorField is specified, use it; otherwise use yField as the value
            const valueField = colorField || yField

            // Check if we have numeric values for the heatmap cells
            const sampleValue = data[0]?.[valueField]
            if (typeof sampleValue !== "number") {
              return {
                success: false,
                error: `Heatmap requires a quantitative value field for color encoding. The field '${valueField}' does not contain numeric values. Please ensure your query includes a numeric aggregation (e.g., COUNT(*), AVG(...), SUM(...)) and specify it via colorField parameter.`
              }
            }

            // Validate: heatmap should have aggregated data (ideally one value per x,y combo)
            const xyPairs = new Map<string, number>()
            data.forEach(d => {
              const key = `${d[xField]}|${d[yField]}`
              xyPairs.set(key, (xyPairs.get(key) || 0) + 1)
            })

            const duplicates = Array.from(xyPairs.values()).filter(count => count > 1).length
            if (duplicates > 0) {
              console.warn(`⚠️  Heatmap has ${duplicates} duplicate x,y combinations. Data should be aggregated with GROUP BY ${xField}, ${yField}.`)
            }

            // Determine axis label angles based on category counts
            const uniqueXCategories = new Set(data.map(d => d[xField])).size
            const uniqueYCategories = new Set(data.map(d => d[yField])).size
            const xLabelAngle = uniqueXCategories > 10 ? -45 : 0

            // Warn if too many categories (readability issue)
            if (uniqueXCategories > 30 || uniqueYCategories > 30) {
              console.warn(`⚠️  Heatmap has ${uniqueXCategories}×${uniqueYCategories} cells. Consider filtering or binning for better readability (recommend ≤30 categories per dimension).`)
            }

            spec.mark = {
              type: "rect",
              tooltip: true,
              invalid: "filter", // Exclude null/NaN values
            }
            spec.encoding = {
              x: {
                field: xField,
                type: "nominal",
                axis: {
                  title: xAxisLabel || xField,
                  labelAngle: xLabelAngle,
                  labelOverlap: "greedy" as const,
                  labelPadding: 5,
                  labelLimit: 100,
                },
              },
              y: {
                field: yField,
                type: "nominal",
                axis: {
                  title: yAxisLabel || yField,
                  labelOverlap: "greedy" as const,
                },
              },
              color: {
                field: valueField,
                type: "quantitative",
                scale: {
                  scheme: "blues", // Sequential color scheme for quantitative values
                  // Can also use "viridis", "magma", "inferno" for better perceptual uniformity
                },
                legend: {
                  title: colorField ? (yAxisLabel || valueField) : (yAxisLabel || yField),
                  orient: "right",
                },
              },
              tooltip: [
                { field: xField, type: "nominal", title: xAxisLabel || xField },
                { field: yField, type: "nominal", title: yAxisLabel || yField },
                { field: valueField, type: "quantitative", title: colorField ? valueField : (yAxisLabel || yField), format: tooltipFormat },
              ],
            }
          }

          // Store in runs table with correct schema
          const supabaseViz = await createServerClient()
          await supabaseViz.from("runs").insert({
            dataset_id: datasetId,
            type: "chart",
            status: "success",
            chart_spec: spec,
            insight: title, // Use chart title as the insight
            sql: sqlQuery, // Store source SQL query
            sample: data, // Store the data results
            columns: columns, // Store column names
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
executeSQLQuery: Execute SELECT query against dataset. Returns {success, queryId, rowCount, preview, analysis}. Use 'analysis' field for insights from full results.

createChart: Generate Vega-Lite visualization from queryId. Automatically fetches optimal data amount per chart type.
Chart types: bar (comparisons), line (trends), scatter (correlations), boxplot (distributions), area (cumulative), pie (proportions), heatmap (2D patterns).
Returns {success, chartSpec, error}.
</tools>

<sql_rules>
PostgreSQL dialect - SELECT only against \`${dataset.table_name}\`:

1. CTE & Grouping: Use CTE named 'base' for derived fields (CASE, calculated columns). GROUP BY ordinals (1,2,3) or alias names from base CTE. Quote reserved words ("default", "user", "order").
2. Query limits: LIMIT ≤ 1500. No semicolons.
3. PostgreSQL functions: || for concat. DATE_TRUNC()/EXTRACT() for temporal. FILTER (WHERE) for conditional aggregations.
4. Type safety: Booleans as CASE WHEN y THEN 1.0 ELSE 0.0 END. Use NULLIF for divide-by-zero protection. No mixed types in IN().
5. Filtering: WHERE filters rows before aggregation. HAVING filters aggregated results.
6. ORDER BY: Only at outermost SELECT (unless CTE needs LIMIT).
</sql_rules>

<output_format>
Deliver analysis in two sections:

=== EXECUTIVE SUMMARY ===
[3-5 key insights in max 10 sentences with evidence inline]

See Charts tab for visualizations and SQL tab for detailed queries.

You might also explore:
[3 follow-up questions]

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
- Purpose: Generate Vega-Lite visualization from SQL query results (queryId)
- Returns: {success, chartSpec, error}
- System automatically fetches optimal data amount per chart type

Chart Selection by Data Types:
• bar: categorical x + quantitative y (aggregated comparisons) - use for AVG/SUM/COUNT results
• line: temporal x + quantitative y (trends over time)
• scatter: quantitative x + quantitative y (correlations)
• boxplot: categorical x + quantitative y (distributions, outliers) - requires raw data (3+ per category), NOT aggregated
• area: temporal x + quantitative y (cumulative patterns)
• pie: categorical only (3-7 categories)
• heatmap: categorical x + categorical y + quantitative z (bivariate patterns) - requires aggregated data (GROUP BY x, y), use colorField for value

Decision Rule: Categorical+Quantitative → bar (if aggregated) or boxplot (if raw data) | Quantitative+Quantitative → scatter | Temporal+Quantitative → line/area | Categorical+Categorical+Quantitative → heatmap

Data Volume Best Practices:
1. For scatter/line/area expecting >5K points: aggregate data first (bin numeric values, downsample, or use coarser time granularity)
2. Boxplots auto-handle large datasets via SQL aggregation
3. Heatmaps: limit to ≤30 categories per dimension for readability

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
