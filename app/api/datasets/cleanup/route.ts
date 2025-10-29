import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sanitizeTableName } from "@/lib/sql-guard"
import { getPostgresPool } from "@/lib/postgres"

// Session-based cleanup: Delete datasets older than 24 hours
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // Verify request is from Vercel Cron (security check)
    const userAgent = req.headers.get("user-agent")
    if (!userAgent?.includes("vercel-cron")) {
      console.warn("Cleanup attempt from non-cron source:", userAgent)
      // Allow manual testing in development, but log the attempt
    }

    // Find datasets older than 24 hours - RLS will automatically filter by user_id
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: oldDatasets, error: fetchError } = await supabase
      .from("datasets")
      .select("id")
      .lt("created_at", cutoffTime)

    if (fetchError) {
      console.error("Cleanup fetch error:", fetchError)
      return NextResponse.json({ error: "Failed to fetch old datasets" }, { status: 500 })
    }

    if (!oldDatasets || oldDatasets.length === 0) {
      return NextResponse.json({ message: "No datasets to clean up", deleted: 0 })
    }

    // Delete each dataset and its table
    let deletedCount = 0
    const pool = getPostgresPool()

    for (const dataset of oldDatasets) {
      const tableName = sanitizeTableName(dataset.id)

      try {
        // Step 1: Drop the data table (using Postgres pool for DDL operations)
        // Must happen BEFORE deleting metadata record (need table_name reference)
        await pool.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`)
        console.log(`Dropped table: ${tableName}`)

        // Step 2: Delete metadata record (cascades to runs, chat_turns, reports via FK)
        const { error: deleteError } = await supabase.from("datasets").delete().eq("id", dataset.id)

        if (!deleteError) {
          deletedCount++
          console.log(`Deleted dataset metadata: ${dataset.id}`)
        } else {
          console.error(`Failed to delete dataset metadata ${dataset.id}:`, deleteError)
        }
      } catch (err) {
        console.error(`Failed to cleanup dataset ${dataset.id}:`, err)
        // Continue with next dataset even if this one fails
      }
    }

    return NextResponse.json({
      message: `Cleaned up ${deletedCount} old datasets`,
      deleted: deletedCount,
    })
  } catch (error) {
    console.error("Cleanup error:", error)
    return NextResponse.json({ error: "Failed to clean up datasets" }, { status: 500 })
  }
}
