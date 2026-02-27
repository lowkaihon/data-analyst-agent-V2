import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates server-side and handles token refresh automatically.
  // Unlike getSession(), it doesn't trust the cookie blindly.
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Only create anonymous session if no auth cookies exist (truly new visitor).
    // If cookies exist but validation failed (network error, concurrent refresh, etc.),
    // don't replace the session — avoids orphaning the user's datasets.
    const hasAuthCookies = request.cookies.getAll().some(
      c => c.name.startsWith('sb-') && c.name.includes('auth-token')
    )

    if (!hasAuthCookies) {
      const { error } = await supabase.auth.signInAnonymously()
      if (error) {
        console.error('Failed to create anonymous session:', error)
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/datasets/cleanup (cron job endpoint - skip auth)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|api/datasets/cleanup|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
