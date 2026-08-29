import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Exchanges the one-time code from a confirmation or password-reset email for a
 * session cookie, then forwards the user where they were going.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';
  const safeNext = next.startsWith('/') ? next : '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?message=${encodeURIComponent('That link is no longer valid.')}`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?message=${encodeURIComponent(error.message)}`);
  }
  return NextResponse.redirect(`${origin}${safeNext}`);
}
