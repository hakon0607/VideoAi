import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * Server-side Supabase client bound to the request's cookies. Runs with the
 * user's own JWT, so every query is still subject to Row Level Security.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component: the middleware refreshes the
            // session instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/** Returns the signed-in user, or null. */
export async function getUser() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
