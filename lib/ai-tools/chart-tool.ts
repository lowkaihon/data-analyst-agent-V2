/**
 * Chart Creation Tool for AI SDK
 *
 * Generates Vega-Lite visualizations from SQL query results.
 * Extracted from route.ts to improve maintainability and testability.
 */

import { tool } from "ai"
import { z } from "zod"
import { Pool } from "@neondatabase/serverless"
import { guardSQL } from "@/lib/sql-guard"
import { createServerClient } from "@/lib/supabase/server"
import { buildChartSpec } from "@/lib/charts/chart-specs"
import { validateChartFields } from "@/lib/validation-utils"
import type { Dataset } from "@/lib/types"
import type { User } from "@supabase/supabase-js"

/**
 * Create chart generation tool with runtime context.
 * Uses factory pattern to inject dataset, user, and database pool at runtime.
 *
 * @param params - Runtime context for chart creation
 * @returns AI SDK tool for generating Vega-Lite charts
 */
export function createChartTool(params: {
  datasetId: string
  dataset: Dataset
  user: User
  pool: Pool
}) {
  const { datasetId, dataset, user, pool } = params

  return tool({
    description: `Create Vega-Lite chart from COMPLETED query results. REQUIRES a valid queryId returned by executeSQLQuery. IMPORTANT: executeSQLQuery must complete successfully before calling this tool. Never call both tools in parallel - always wait for executeSQLQuery to return a queryId first. Automatically fetches optimal data amount based on chart type.`,
    inputSchema: z.object({
      queryId: z.string().describe("QueryId returned by a COMPLETED executeSQLQuery call. Must be a valid UUID from a successful query execution. Never use placeholders."),
      chartType: z.enum(["bar", "line", "scatter", "area", "pie", "boxplot", "heatmap"]).describe("bar: categorical x + quantitative y (comparisons), line: temporal/ordered x + quantitative y (trends), scatter: quantitative x + quantitative y (correlations), area: temporal x + quantitative y (cumulative), pie: categorical (3-7 categories), boxplot: categorical x + quantitative y (distributions) - REQUIRES raw unaggregated data with 3+ points per category; for pre-aggregated data (AVG/SUM/COUNT) use bar chart, heatmap: categorical x + categorical y + quantitative z (2D patterns) - REQUIRES aggregated data (one row per x,y combination via GROUP BY x, y)"),
      xField: z.string().describe("Column for x-axis (must exist in query results)"),
      yField: z.string().describe("Column for y-axis (must exist in query results)"),
      title: z.string().describe("Descriptive title explaining the insight"),
      subtitle: z.string().optional().describe("Optional subtitle for additional context"),
      xAxisLabel: z.string().optional().describe("Custom x-axis label (default: xField name)"),
      yAxisLabel: z.string().optional().describe("Custom y-axis label (default: yField name)"),
      colorField: z.string().optional().describe("Field to color by for categorical grouping. ESSENTIAL for scatter plots with grouped data (e.g., GROUP BY with 2+ fields) - enables legends and distinguishes categories. Without colorField, users cannot identify what each point represents. Use: categorical for bar/line/scatter/area; quantitative value field for heatmap; not used for pie/boxplot. Example: For 'GROUP BY job, education', use colorField='job' or 'education' to reveal patterns and show legend."),
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

      // Validate that specified fields exist in query results
      const validation = validateChartFields(
        { xField, yField, colorField },
        columns
      )

      if (!validation.valid) {
        const errorMsg = validation.errors.join('. ')
        const availableList = `Available columns: ${columns.join(', ')}`

        // Build suggestion message if we have any
        const suggestionParts = Object.entries(validation.suggestions).map(
          ([fieldName, suggestion]) => `${fieldName}='${suggestion}'`
        )
        const suggestionMsg = suggestionParts.length > 0
          ? ` Did you mean: ${suggestionParts.join(', ')}?`
          : ''

        console.error("Field validation failed:", errorMsg)
        return {
          success: false,
          error: `${errorMsg}. ${availableList}.${suggestionMsg}`,
        }
      }

      // Chart-type-specific validation
      const sqlUpper = sqlQuery.toUpperCase()

      if (chartType === "boxplot") {
        // Check if query contains aggregation (which would make boxplot invalid)
        const hasAggregation = /\b(AVG|SUM|COUNT|MIN|MAX)\s*\(/i.test(sqlQuery)
        const hasGroupBy = /\bGROUP\s+BY\b/i.test(sqlUpper)

        if (hasAggregation || hasGroupBy) {
          return {
            success: false,
            error: `Boxplot requires raw, unaggregated data but your query contains ${hasAggregation ? 'aggregation functions (AVG/SUM/COUNT)' : 'GROUP BY'}. For aggregated data showing ${yField} by ${xField}, use chartType='bar' instead.`,
          }
        }
      }

      if (chartType === "heatmap") {
        // Heatmap requires a value field for color encoding
        if (!colorField) {
          return {
            success: false,
            error: `Heatmap requires a colorField parameter to specify the quantitative value for color encoding. This should be a numeric column from your aggregated data (e.g., COUNT(*), AVG(...), SUM(...)). Available columns: ${columns.join(', ')}.`,
          }
        }
      }

      // Determine chart-type-specific limit for optimal visualization
      const chartLimit = chartType === "boxplot" ? 10000
                       : ["scatter", "line", "area"].includes(chartType) ? 5000
                       : 1500 // bar, pie, heatmap (aggregated data)

      console.log(`Re-querying with ${chartLimit} row limit for ${chartType} chart`)

      // Check actual row count to determine if we need special handling
      // Build a COUNT query by wrapping the original SQL
      // Strip LIMIT/OFFSET clauses to get the true row count
      const sqlWithoutLimit = sqlQuery
        .replace(/;?\s*$/, '')
        .replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?/gi, '')
      const countSQL = `SELECT COUNT(*) FROM (${sqlWithoutLimit}) as subquery`
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

      // Build chart specification using extracted function
      const chartResult = await buildChartSpec({
        chartType,
        data,
        xField,
        yField,
        colorField,
        title,
        subtitle,
        xAxisLabel,
        yAxisLabel,
        useAggregates,
      })

      if (!chartResult.success) {
        return {
          success: false,
          error: chartResult.error,
        }
      }

      const spec = chartResult.spec

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
        user_id: user.id,
      })

      return {
        success: true,
        spec,
      }
    },
  })
}
