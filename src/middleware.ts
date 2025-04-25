import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function middleware(request: NextRequest) {
  // First, update the session cookie
  const response = await updateSession(request)

  // Create a Supabase client to check auth status
  // NOTE: Using createClient() here might re-read cookies that updateSession just set.
  // This is a common pattern, though slightly redundant. Alternatively, 
  // the logic could be combined if updateSession exposed the session.
  const supabase = await createClient()

  // Check if user is authenticated
  const { data: { session } } = await supabase.auth.getSession()

  const { pathname } = request.nextUrl

  // Define protected routes
  const protectedRoutes = ['/inbox'] // Add any other routes that need auth

  // If user is not logged in and trying to access a protected route
  if (!session && protectedRoutes.some(path => pathname.startsWith(path))) {
    // Redirect to login page
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // If user is logged in and trying to access login page, redirect to inbox
  if (session && pathname === '/auth/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/inbox'
    return NextResponse.redirect(url)
  }

  // Otherwise, continue with the response from updateSession
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
