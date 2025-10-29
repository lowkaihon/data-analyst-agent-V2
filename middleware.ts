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

  // Get the current session
  const {
    data: { session },
  } = await supabase.auth.getSession()

  // If there's no session, create an anonymous user
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously()

    if (error) {
      console.error('Failed to create anonymous session:', error)
    } else {
      console.log('Created anonymous session:', data.user?.id)
    }
  } else {
    // Check if session is about to expire (within 1 hour)
    const expiresAt = session.expires_at ? new Date(session.expires_at * 1000) : null
    const now = new Date()
    const oneHour = 60 * 60 * 1000

    if (expiresAt && expiresAt.getTime() - now.getTime() < oneHour) {
      // Refresh session
      const { error } = await supabase.auth.refreshSession()
      if (error) {
        console.error('Failed to refresh session:', error)
      } else {
        console.log('Session refreshed successfully')
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
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
