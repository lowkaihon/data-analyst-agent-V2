import { openai } from "@ai-sdk/openai"
import { convertToModelMessages, streamText, stepCountIs } from "ai"
import { getPostgresPool } from "@/lib/postgres"
import { createServerClient } from "@/lib/supabase/server"
import { buildDeepDiveSystemPrompt, buildNormalModePrompt } from "@/lib/prompts/chat-prompts"
import { createSQLQueryTool } from "@/lib/ai-tools/sql-query-tool"
import { createChartTool } from "@/lib/ai-tools/chart-tool"

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

    // Fetch dataset metadata and verify ownership
    const supabase = await createServerClient()

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return new Response("Authentication required", { status: 401 })
    }

    // Fetch dataset - RLS will automatically filter by user_id
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .select("*")
      .eq("id", datasetId)
      .single()

    if (datasetError || !dataset) {
      console.error("Dataset fetch error:", datasetError)
      return new Response("Dataset not found or access denied", { status: 404 })
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

    // Create AI tools with runtime context using factory pattern
    const tools = {
      executeSQLQuery: createSQLQueryTool({
        datasetId,
        dataset,
        user,
        pool,
        isDeepDive
      }),
      createChart: createChartTool({
        datasetId,
        dataset,
        user,
        pool
      })
    }

    // Deep-dive prompt is now imported from lib/prompts/chat-prompts.ts
    // Fetch schema for deep-dive mode
    let schemaColumns = ''
    if (isDeepDive) {
      const pool = getPostgresPool()
      const columnsQuery = `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name != 'id'
        ORDER BY ordinal_position
      `
      const columnsResult = await pool.query(columnsQuery, [dataset.table_name])
      schemaColumns = columnsResult.rows.map(col => {
        const type = col.data_type === 'integer' || col.data_type === 'double precision' || col.data_type === 'numeric'
          ? 'number'
          : col.data_type === 'boolean' ? 'boolean' : 'text'
        return `- ${col.column_name} (${type})`
      }).join('\n')
    }

    // Build adaptive deep-dive system prompt
    const deepDiveSystemPrompt = buildDeepDiveSystemPrompt(dataset, schemaColumns)

    // Normal Mode - prompt is now imported from lib/prompts/chat-prompts.ts
    const systemPrompt = buildNormalModePrompt(dataset)
    const result = streamText({
      model: openai(isDeepDive ? "gpt-5-mini" : "gpt-4o"),
      system: isDeepDive ? deepDiveSystemPrompt : systemPrompt,
      messages: convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(isDeepDive ? 50 : 10),  // Deep dive: supports 22-35 queries + 6-7 charts (28-42 tool calls) with comfortable buffer. Normal: responsive Q&A (10 steps).
      // Only apply reasoningEffort for reasoning models
      providerOptions: {
        openai: {
          reasoningEffort: 'medium'
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
      onFinish: async ({ text, finishReason, steps }) => {
        // Response validation: Check if text response is missing
        if (!text || text.trim().length === 0) {
          console.error("⚠️  EMPTY TEXT RESPONSE DETECTED:", {
            finishReason,
            stepCount: steps?.length || 0,
            mode: isDeepDive ? "deep-dive" : "normal",
            lastStepToolCalls: steps?.[steps.length - 1]?.toolCalls?.map(tc => tc.toolName) || "none"
          })
        }

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
              user_id: user.id,
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
