import { openai } from "@ai-sdk/openai"
import { convertToModelMessages, streamText, tool } from "ai"
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
        description:
          "Execute a SELECT query against the dataset table. Use this to explore data, calculate statistics, filter rows, or answer analytical questions. Always use LIMIT to avoid large result sets.",
        inputSchema: z.object({
          query: z.string().describe("The SQL SELECT query to execute. Must be a SELECT statement only."),
          reasoning: z.string().describe("Brief explanation of what this query will reveal"),
        }),
        execute: async ({ query, reasoning }) => {
          console.log("[v0] Executing SQL:", query)
          console.log("[v0] Reasoning:", reasoning)

          try {
            // Guard SQL to ensure it's SELECT-only and add LIMIT
            const guardedSQL = guardSQL(query, dataset.table_name)
            const result = await pool.query(guardedSQL)

            // Store in runs table
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              tool_name: "executeSQLQuery",
              tool_input: { query: guardedSQL, reasoning },
              tool_output: {
                rows: result.rows,
                rowCount: result.rowCount,
              },
              status: "success",
            })

            return {
              success: true,
              rows: result.rows,
              rowCount: result.rowCount,
              reasoning,
            }
          } catch (error: any) {
            console.error("[v0] SQL execution error:", error)
            return {
              success: false,
              error: error.message,
              reasoning,
            }
          }
        },
      }),

      suggestViz: tool({
        description:
          "Generate a Vega-Lite visualization specification based on data analysis results. Use this after executing SQL queries to create charts.",
        inputSchema: z.object({
          data: z.array(z.record(z.any())).describe("The data rows to visualize"),
          chartType: z.enum(["bar", "line", "scatter", "area", "pie"]).describe("The type of chart to create"),
          xField: z.string().describe("The field to use for x-axis"),
          yField: z.string().describe("The field to use for y-axis"),
          title: z.string().describe("The chart title"),
        }),
        execute: async ({ data, chartType, xField, yField, title }) => {
          console.log("[v0] Generating chart:", chartType)

          const spec = {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            title,
            width: 400,
            height: 300,
            data: { values: data },
            mark: chartType,
            encoding: {
              x: { field: xField, type: "nominal" },
              y: { field: yField, type: "quantitative" },
            },
          }

          // Store in runs table
          const supabase = await createServerClient()
          await supabase.from("runs").insert({
            dataset_id: datasetId,
            tool_name: "suggestViz",
            tool_input: { chartType, xField, yField, title },
            tool_output: { spec },
            status: "success",
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

            // Store in runs table
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              tool_name: "validate",
              tool_input: { checkType, column },
              tool_output: { result: result.rows[0] },
              status: "success",
            })

            return {
              success: true,
              result: result.rows[0],
              checkType,
              column,
            }
          } catch (error: any) {
            console.error("[v0] Validation error:", error)
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

            // Store in runs table
            const supabase = await createServerClient()
            await supabase.from("runs").insert({
              dataset_id: datasetId,
              tool_name: "profile",
              tool_input: { includeStats },
              tool_output: profile,
              status: "success",
            })

            return {
              success: true,
              profile,
            }
          } catch (error: any) {
            console.error("[v0] Profile error:", error)
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

Your role:
1. First, use the 'profile' tool to understand the dataset structure
2. Verify the user's context against the actual data
3. Suggest relevant analyses and questions to explore based on both the context and data structure
4. Use tools autonomously to answer questions: executeSQLQuery, suggestViz, validate, profile
5. Always explain your findings clearly and suggest next steps

Be proactive, insightful, and help the user discover valuable insights in their data.`
      : `You are a data analyst AI assistant.

Dataset: ${dataset.table_name} (${dataset.row_count} rows, ${dataset.column_count} columns)

Your role:
1. First, use the 'profile' tool to understand the dataset structure
2. Suggest relevant analyses and questions to explore based on the data structure
3. Use tools autonomously to answer questions: executeSQLQuery, suggestViz, validate, profile
4. Always explain your findings clearly and suggest next steps

Be proactive, insightful, and help the user discover valuable insights in their data.`

    console.log("[v0] Starting streamText with", messages.length, "messages")

    const result = streamText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages: convertToModelMessages(messages),
      tools,
      maxSteps: 10,
      onStepFinish: ({ stepType, toolCalls, toolResults }) => {
        console.log("[v0] Step finished:", stepType)
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
