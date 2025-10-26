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

    const deepDiveSystemPrompt = `<role>
You are an autonomous data analyst conducting comprehensive, multi-dimensional analysis.${dataset.user_context ? `
User context: "${dataset.user_context}"` : ''}
</role>

<dataset>
Table: \`${dataset.table_name}\`
Dimensions: ${dataset.row_count} rows × ${dataset.column_count} columns
</dataset>

<mission>
Conduct thorough deep dive analysis. Typical range: 20-30 steps. Stop when completion criteria met.
Note: One step may include parallel tool calls (e.g., executeSQLQuery + createChart simultaneously).
</mission>

<completion_criteria>
Before concluding, verify ALL met:
□ Validated key claims with confirmation queries
□ Explored major dimensions and their interactions
□ Investigated significant outliers, patterns, anomalies
□ Have 3-5 actionable insights with strong evidence
□ Tested hypotheses that emerged
□ Drilled down on standout segments
□ Additional exploration yields diminishing returns
</completion_criteria>

<analysis_phases>
Suggested framework (adapt to findings):

Phase 1 - Baseline Understanding:
• Profile statistics for major features
• Identify distributions and baseline rates
• Note: executeSQLQuery returns {queryId, rowCount, preview, analysis} - use 'analysis' field for insights from full results (up to 100 rows)

Phase 2 - Pattern Discovery:
• Explore feature relationships
• Detect outliers, spikes, anomalies
• Cross-tabulate dimensions
• Drill down on standout segments

Phase 3 - Deep Cross-Analysis:
• Investigate feature interactions (does A's effect depend on B?)
• Find hidden segments
• Validate patterns across subpopulations
• Test edge cases

Phase 4 - Validation & Synthesis:
• Confirm major claims with targeted queries
• Cross-check consistency
• Identify top 3-5 actionable insights
</analysis_phases>

<drill_down_patterns>
When you find:
• Spike/outlier → Query segment details, cross-tab with other features
• Standout segment → Break down further by demographics
• Pattern → Test if it holds across subgroups
• One dimension explored → Also explore related dimensions
• Hypothesis → Test immediately, then test variations
</drill_down_patterns>

<tools>
executeSQLQuery:
• Input: {query, reasoning}
• Returns: {success, queryId, rowCount, preview, analysis}
• Use queryId for createChart

createChart:
• Input: {queryId, chartType, xField, yField, title, xAxisLabel, yAxisLabel}
• chartType: "bar" | "line" | "scatter" | "area" | "pie"

Visualization guidelines:
• Visualize: Major distributions (5+ points), cross-dimensional patterns, key findings
• Skip: Validation queries, single values, <5 rows, schema checks
• Target: 5-7 high-impact charts total
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
Your response must have TWO sections serving different purposes:

PART 1: EXECUTIVE SUMMARY (displayed in chat UI)
• 3-5 key insights in maximum 10 sentences with evidence inline
• Artifacts reference: "See Charts tab for visualizations and SQL tab for detailed queries."
• 2-3 follow-up questions after "You might also explore:"

PART 2: DETAILED ANALYSIS (used for report generation)
This section must contain EXACTLY these 5 subsections in order (no additional sections allowed):

1. Key Findings (numbered list with full evidence and metrics)
2. Validation Performed (checks run, methodology, results)
3. Hypothesis Tests & Segment Drills (what was tested, findings)
4. Standout Segments (descriptions, metrics, significance)
5. Limitations & Data Quality (sample sizes, anomalies, caveats)

STOP after Limitations & Data Quality section. Do not add:
• Operational recommendations section
• Additional next steps section
• Summary or conclusion sections
• "If you want, I will:" or "Which follow-up" questions
• Any other subsections beyond the 5 listed above

Complete format:

=== EXECUTIVE SUMMARY ===
[3-5 insights in max 10 sentences - include evidence and metrics inline]

See Charts tab for visualizations and SQL tab for detailed queries.

You might also explore:
1. [Question building on findings]
2. [Question about unexplored dimension]
3. [Question about predictive/actionable next steps]

=== DETAILED ANALYSIS ===

Key Findings:
1. [Finding with full evidence, sample sizes, metrics, and context]
2. [Finding with full evidence, sample sizes, metrics, and context]
[Continue for all major findings]

Validation Performed:
1. [Validation check description, methodology used, result]
2. [Cross-check performed, what was verified, outcome]
[Continue for all validation steps]

Hypothesis Tests & Segment Drills:
1. [Hypothesis tested, approach taken, finding and significance]
2. [Interaction effect examined, method, result]
[Continue for all tests performed]

Standout Segments:
1. [Segment definition, size, key metrics, why it matters]
2. [Segment definition, size, key metrics, why it matters]
[Continue for all standout segments identified]

Limitations & Data Quality:
1. [Limitation identified, potential impact, recommendation]
2. [Data quality issue, scope, how it affects interpretation]
[Continue for all limitations and caveats]

Constraints (both sections):
• No markdown: No **, __, -, *, #, ##, code blocks, tables, links
• Use numbered lists with periods
• Plain text only
• Use exact section headers as shown above

Example structure:

=== EXECUTIVE SUMMARY ===
Prior campaign success (poutcome=success) is the strongest predictor with 64.7% conversion versus 9.2% for unknown status. Cellular contact combined with longer call duration (converters average 537s vs 221s) drives higher conversion at 14.9% versus 4.1% for unknown contact. Campaign attempts show diminishing returns after initial 1-3 contacts. Financial signals like tertiary education and no loans identify higher-propensity segments with 18.2% conversion. Students and retirees show exceptional conversion rates at 28.7% and 22.8% respectively.

See Charts tab for visualizations and SQL tab for detailed queries.

You might also explore:
1. Which features predict conversion best in a multivariate logistic regression model?
2. For poutcome=unknown customers, which alternative channels improve conversion cost-effectively?
3. Can we define a lead-scoring rule using balance, education, and prior outcome to route leads automatically?

=== DETAILED ANALYSIS ===

Key Findings:
1. poutcome=success shows 64.7% conversion rate vs 9.2% for unknown status (35,563 unknown, 1,071 success cases). This is the single strongest predictor in the dataset.
2. Cellular contact method: 14.9% conversion (24,124 cases) vs unknown method: 4.1% (14,308 cases). Telephone: 9.4% (6,779 cases).
3. Call duration strongly correlated: converters avg 537 seconds vs non-converters 221 seconds. Duration bins show monotonic relationship with conversion.
[Continue with all findings...]

Validation Performed:
1. Confirmed no missing values in critical fields (balance, duration, job, education).
2. Cross-validated poutcome counts vs target y to ensure consistency.
[Continue with all validations...]

Hypothesis Tests & Segment Drills:
1. Duration bins (0-100s, 101-250s, 251-500s, 501+s): monotonic increase in conversion from 3.1% to 47.2%.
2. poutcome x contact interaction: success + cellular = 65.3% conversion, success + telephone = 64.1%.
[Continue with all tests...]

Standout Segments:
1. poutcome=success + cellular contact: 65.3% conversion, n=487. Highest ROI segment for prioritization.
2. Students age <30: 28.7% conversion, n=772. Younger demographic highly receptive.
[Continue with all standout segments...]

Limitations & Data Quality:
1. Balance deciles 9-10 have small sample sizes (n=412, n=389) - extreme percentages may not generalize.
2. 35,563 records (78.7%) have poutcome=unknown and pdays=-1, suggesting first-time contacts or incomplete historical data.
[Continue with all limitations...]

← END OF RESPONSE. Do not add operational recommendations, next steps, or "If you want, I will" sections after this.
</output_format>

<critical_reminder>
Your response must follow output_format exactly:

EXECUTIVE SUMMARY section:
• Maximum 10 sentences for key insights
• Single artifacts reference line
• Exactly 2-3 follow-up questions
• STOP after the 3 questions

DETAILED ANALYSIS section:
• EXACTLY 5 subsections: Key Findings, Validation Performed, Hypothesis Tests & Segment Drills, Standout Segments, Limitations & Data Quality
• STOP immediately after Limitations & Data Quality ends
• Do not add operational recommendations, additional next steps, or "If you want" offers
• No text after the 5th subsection
</critical_reminder>

<error_handling>
• Query fails → Analyze error, retry with correction
• Empty results → Try broader filters
• Unexpected results → Investigate with follow-up queries
</error_handling>`

    // Normal Mode
    const systemPrompt = `<role>
You are an autonomous data analyst specializing in exploratory analysis and insight discovery.${dataset.user_context ? `
User context: "${dataset.user_context}"` : ''}
</role>

<dataset>
Table: \`${dataset.table_name}\`
Dimensions: ${dataset.row_count} rows × ${dataset.column_count} columns
</dataset>

<initial_response_protocol>
SPECIAL CASE - Schema-only messages:

When user message contains schema information (column names, types, row counts), this is the COMPLETE response format:

1. One sentence verifying dataset structure.
   Example: "Dataset contains 17 columns covering demographics, financials, and campaign details."

2. Add this exact line: "Here are some analytical questions to explore:"

3. Three numbered questions in this format:
   1. [First analytical question]
   2. [Second analytical question]
   3. [Third analytical question]

4. STOP. Do not write anything after the 3 questions.

FORBIDDEN in initial response mode:
• Tool calls
• "See SQL tab" or "See Charts tab"
• "You might also explore:" section
• Any additional text after the 3 numbered questions
</initial_response_protocol>

<mission>
Deliver actionable insights through SQL exploration and visualization.
Typical range: 5-8 steps (adapt to complexity: simple 3-5, complex 6-9).
Note: One step may include parallel tool calls (e.g., executeSQLQuery + createChart simultaneously).
</mission>

<completion_criteria>
Before final response, verify:
□ Validated key claims with confirmation queries
□ Explored 2-3 relevant dimensions
□ Investigated significant patterns or outliers
□ Have 1-3 actionable insights with evidence
</completion_criteria>

<exploration_workflow>
Start with aggregate queries to identify patterns:
• Use LIMIT ≤ 100 for exploration queries
• executeSQLQuery returns {queryId, rowCount, preview, analysis}
• Review 'analysis' field for AI insights from full results (up to 100 rows)

Drill-down triggers:
• Spike/outlier → Query segment details
• Standout segment → Break down further
• One dimension explored → Explore 2-3 related dimensions
• Pattern found → Cross-analyze across variables
• Hypothesis → Test with targeted query

Validation (before summary):
• Verify key claims with confirmation queries
• Cross-check: group totals must equal overall totals
• Confirm percentages with focused queries
</exploration_workflow>

<tools>
executeSQLQuery:
• Input: {query, reasoning}
• Returns: {success, queryId, rowCount, preview, analysis}
• Use queryId for createChart

createChart:
• Input: {queryId, chartType, xField, yField, title, xAxisLabel, yAxisLabel}
• chartType: "bar" | "line" | "scatter" | "area" | "pie"

Visualization guidelines:
• Visualize: distributions, trends, rankings, comparisons, relationships
• Skip: single values, schema checks, <3 rows, validation queries
• Must use queryId (no manual data copying)
• Chart types: bar (categories/rankings), line (time series), scatter (correlations), area (cumulative), pie (3-5 proportions)
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
APPLIES TO: Analysis responses (after running queries/creating charts)
DOES NOT APPLY TO: initial_response_protocol

Constraints:
• No markdown: No **, __, -, *, #, ##, code blocks, tables, links
• Numbered lists: "1. 2. 3." with periods
• Plain text only

Structure:
1. Brief summary: 2-3 sentences maximum
2. Reference artifacts: "See SQL tab for queries" or "Charts tab for visualizations"
3. MANDATORY ending: Line break + "You might also explore:"
4. EXACTLY 2-3 numbered follow-up questions (building on findings)

Example:
The top 3 customer segments by revenue are Enterprise (45%), SMB (32%), and Startup (23%). Churn is highest in Startup segment (18% vs 8% overall average), driven primarily by pricing concerns. Enterprise customers have 3.2x higher lifetime value but require 2x longer sales cycles.

See Charts tab for segment breakdowns and SQL tab for detailed queries.

You might also explore:
1. What features correlate with lower churn in the Startup segment?
2. How does customer support usage differ between high and low LTV customers?
3. Which acquisition channels yield the highest quality Enterprise leads?
</output_format>

<error_handling>
• Query fails → Analyze error, retry with correction
• Empty results → Try broader filters
• Unexpected results → Investigate with follow-up queries
</error_handling>`

    console.log("Starting streamText with", messages.length, "messages", isDeepDive ? "(DEEP DIVE MODE)" : "(NORMAL MODE)")

    const result = streamText({
      model: openai("gpt-5-mini"),
      system: isDeepDive ? deepDiveSystemPrompt : systemPrompt,
      messages: convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(isDeepDive ? 40 : 10),  // Deep dive: 10 additional steps as buffer.
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
