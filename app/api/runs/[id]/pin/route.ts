import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { pinned } = await req.json()

    const supabase = await createClient()

    const { error } = await supabase.from("runs").update({ pinned }).eq("id", id)

    if (error) {
      console.error("Pin update error:", error)
      return NextResponse.json({ error: "Failed to update pin status" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Pin error:", error)
    return NextResponse.json({ error: "Failed to update pin status" }, { status: 500 })
  }
}
