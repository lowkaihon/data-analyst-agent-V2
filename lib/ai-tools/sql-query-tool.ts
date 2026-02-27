/**
 * SQL Query Tool for AI SDK
 *
 * Executes SELECT queries against uploaded datasets and provides AI-generated analysis.
 * Extracted from route.ts to improve maintainability and testability.
 */

import { tool } from "ai"
import { z } from "zod"
import { Pool } from "@neondatabase/serverless"
import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"
import { guardSQL } from "@/lib/sql-guard"
import { createServerClient } from "@/lib/supabase/server"
import type { Dataset } from "@/lib/types"
import type { User } from "@supabase/supabase-js"

// Query timeout constants
const QUERY_TIMEOUT_NORMAL_MS = 30000 // 30 seconds
const QUERY_TIMEOUT_DEEP_DIVE_MS = 60000 // 60 seconds

/**
 * Create SQL query execution tool with runtime context.
 * Uses factory pattern to inject dataset, user, and database pool at runtime.
 *
 * @param params - Runtime context for query execution
 * @returns AI SDK tool for executing SQL queries
 */
export function createSQLQueryTool(params: {
  datasetId: string
  dataset: Dataset
  user: User
  pool: Pool
  isDeepDive: boolean
}) {
  const { datasetId, dataset, user, pool, isDeepDive } = params

  return tool({
    description: `Execute a SELECT query to explore data. Returns queryId for visualization, columns array (exact field names from query results - use these for createChart), preview (5 rows), and AI analysis of full results. IMPORTANT: Column names in results may differ from original table schema due to aliases or calculated fields.`,
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
          user_id: user.id,
        }).select('id').single()

        if (insertError || !runData) {
          console.error("Error inserting run:", insertError)
        }

        const queryId = runData?.id ?? null

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
              // Engineered AI prompt based on GPT-4o-mini best practices
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
          queryId, // ID to reference this query's data (null if run insert failed)
          rowCount: result.rowCount,
          columns: result.fields.map((f: any) => f.name), // Column names from query results
          preview, // Small preview for AI to examine
          analysis, // Full-dataset insights from sub-agent
          reasoning,
          ...(queryId === null && { note: "Query succeeded but results were not saved. Chart creation is unavailable for this query." }),
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
          user_id: user.id,
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
  })
}
