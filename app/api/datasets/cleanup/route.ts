import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sanitizeTableName } from "@/lib/sql-guard"

// Session-based cleanup: Delete datasets older than 24 hours
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    // Find datasets older than 24 hours
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
    for (const dataset of oldDatasets) {
      const tableName = sanitizeTableName(dataset.id)

      // Drop the data table (this will cascade delete runs, chat_turns via FK)
      try {
        // Note: This requires a custom RPC function or direct SQL execution
        // For now, we'll just delete the dataset record which cascades to runs
        const { error: deleteError } = await supabase.from("datasets").delete().eq("id", dataset.id)

        if (!deleteError) {
          deletedCount++
        }
      } catch (err) {
        console.error(`Failed to delete dataset ${dataset.id}:`, err)
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
