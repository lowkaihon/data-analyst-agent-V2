import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// Vercel cron jobs use GET requests by default
export async function GET(req: NextRequest) {
  // Verify request is from Vercel Cron
  const userAgent = req.headers.get("user-agent") || ""
  if (userAgent !== "vercel-cron/1.0") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = await createAdminClient()

    // Simple query to keep the database active
    const { data, error } = await supabase
      .from("datasets")
      .select("id")
      .limit(1)

    if (error) {
      console.error("Keep-alive query error:", error)
      return NextResponse.json({ error: "Database ping failed" }, { status: 500 })
    }

    console.log("Keep-alive ping successful")
    return NextResponse.json({
      message: "Database ping successful",
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error("Keep-alive error:", error)
    return NextResponse.json({ error: "Keep-alive failed" }, { status: 500 })
  }
}
