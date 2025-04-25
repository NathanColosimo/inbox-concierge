import { createClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient(); // Changed from createClient(cookieStore)

  // Check if user is logged in
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    await supabase.auth.signOut();
  }

  // Redirect to home page after logout
  // Important: Use an absolute URL for redirects in Server Actions/Route Handlers
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = '/';
  redirectUrl.search = ''; // Clear any search params

  return NextResponse.redirect(redirectUrl, {
    // Setting status 303 is important for redirects after POST requests
    status: 303,
  });
} 