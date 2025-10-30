import { createClient } from "@/lib/supabase/server"

/**
 * Rate limiting result
 */
export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  limit: number
}

/**
 * Checks rate limit for a given endpoint using PostgreSQL-based tracking
 *
 * @param endpoint - The API endpoint being accessed (e.g., '/api/ingest')
 * @param limit - Maximum requests allowed within the window
 * @param windowMs - Time window in milliseconds (e.g., 3600000 for 1 hour)
 * @returns Rate limit check result with allowed status, remaining requests, and reset time
 *
 * @example
 * ```typescript
 * // Limit to 5 uploads per hour
 * const { allowed, remaining, resetAt } = await checkRateLimit('/api/ingest', 5, 60 * 60 * 1000)
 * if (!allowed) {
 *   return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
 * }
 * ```
 */
export async function checkRateLimit(
  endpoint: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Rate limit check: Authentication error', authError)
      // Fail open: allow request on authentication errors
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(Date.now() + windowMs),
        limit
      }
    }

    // Calculate window start (aligned to window boundaries)
    const now = Date.now()
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs)
    const resetAt = new Date(windowStart.getTime() + windowMs)

    // Call PostgreSQL function to atomically increment and get count
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_user_id: user.id,
      p_endpoint: endpoint,
      p_window_start: windowStart.toISOString()
    })

    if (error) {
      console.error('Rate limit check: Database error', error)
      // Fail open: allow request on database errors to prevent cascading failures
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt,
        limit
      }
    }

    const requestCount = data as number
    const remaining = Math.max(0, limit - requestCount)
    const allowed = requestCount <= limit

    return {
      allowed,
      remaining,
      resetAt,
      limit
    }
  } catch (error) {
    console.error('Rate limit check: Unexpected error', error)
    // Fail open: allow request on unexpected errors
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: new Date(Date.now() + windowMs),
      limit
    }
  }
}
