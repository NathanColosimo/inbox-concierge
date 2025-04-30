import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  // Update the session and get the response and user object
  const { response, user } = await updateSession(request)

  // Use the user object returned from updateSession for logic
  const session = user // Use 'user' directly for checks
  const { pathname } = request.nextUrl

  // Define protected routes (can be simplified if updateSession handles it)
  // const protectedRoutes = ['/inbox'] 

  // updateSession already handles redirecting unauthenticated users from protected routes
  // if (!session && protectedRoutes.some(path => pathname.startsWith(path))) { ... }

  // If user is logged in and trying to access login page, redirect to inbox
  if (session && pathname === '/auth/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/inbox'
    // Important: Preserve cookies from the updateSession response in this new redirect response
    const redirectResponse = NextResponse.redirect(url)
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
    })
    return redirectResponse
  }

  // Otherwise, continue with the response from updateSession (which has updated cookies)
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
