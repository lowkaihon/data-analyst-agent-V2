import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { checkRateLimit } from "@/lib/rate-limit"

/**
 * Generate a pre-signed upload URL for Supabase Storage
 * This allows the frontend to upload large CSV files directly to storage,
 * bypassing Vercel's 4.5 MB function body limit
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    // Get authenticated user (required for storage uploads)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // Rate limiting: 20 upload URL requests per hour per user
    const rateLimit = await checkRateLimit("/api/storage/upload-url", 20, 60 * 60 * 1000)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Maximum 20 upload requests per hour allowed. Try again after ${rateLimit.resetAt.toLocaleTimeString()}.`,
          resetAt: rateLimit.resetAt.toISOString(),
          limit: rateLimit.limit,
          remaining: rateLimit.remaining,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": rateLimit.limit.toString(),
            "X-RateLimit-Remaining": rateLimit.remaining.toString(),
            "X-RateLimit-Reset": rateLimit.resetAt.toISOString(),
            "Retry-After": Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000).toString(),
          },
        },
      )
    }

    // Parse request body
    const { fileName } = await req.json()

    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 })
    }

    // Validate file extension
    if (!fileName.toLowerCase().endsWith(".csv")) {
      return NextResponse.json(
        { error: "Invalid file extension. Only .csv files are allowed." },
        { status: 400 },
      )
    }

    // Generate unique storage path: {user_id}/{uuid}.csv
    const fileId = crypto.randomUUID()
    const storagePath = `${user.id}/${fileId}.csv`

    // Create a signed upload URL (expires in 5 minutes)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("csv-uploads")
      .createSignedUploadUrl(storagePath)

    if (uploadError) {
      console.error("Error creating signed upload URL:", uploadError)
      return NextResponse.json(
        {
          error: "Failed to create upload URL",
          details: uploadError.message,
        },
        { status: 500 },
      )
    }

    // Return the signed URL and storage path
    return NextResponse.json({
      uploadUrl: uploadData.signedUrl,
      storagePath: storagePath,
      token: uploadData.token,
      expiresIn: 300, // 5 minutes in seconds
    })
  } catch (error) {
    console.error("Upload URL generation error:", error)
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 })
  }
}
