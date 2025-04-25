import { NextResponse } from 'next/server'
// The client you created from the Server-Side Auth instructions
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // if "next" is in param, use it as the redirect URL, otherwise default to /inbox
  const next = searchParams.get('next') ?? '/inbox'

  // Determine the correct base URL for redirection
  const siteUrl = process.env.NODE_ENV === 'development'
    ? origin // Use localhost origin in development (e.g., http://localhost:3000)
    : process.env.VERCEL_PROJECT_PRODUCTION_URL // Use Vercel deployment URL in production
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` // Prepend https for Vercel URL
      : origin; // Fallback to origin (less ideal in prod, but safe)

  if (code) {
    const supabase = await createClient()
    console.log(`OAuth Callback: Attempting code exchange for code starting with ${code.substring(0, 5)}...`);
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      console.log(`OAuth Callback: Code exchange successful. Redirecting to: ${siteUrl}${next}`);
      // On successful exchange, redirect to the determined site URL + next path
      return NextResponse.redirect(`${siteUrl}${next}`)
    } else {
       console.error(`OAuth Callback: Error exchanging code for session: ${error.message}`);
    }
  } else {
     console.error("OAuth Callback: No 'code' parameter found in the request URL.");
  }

  // If code exchange fails or no code is present, redirect to an error page
  // Use the reliable siteUrl for the redirect base
  console.log(`OAuth Callback: Failed. Redirecting to error page: ${siteUrl}/auth/error`);
  return NextResponse.redirect(`${siteUrl}/auth/error`)
}
