'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Browser Supabase client. Only ever sees the public anon key. */
export function createClient() {
  if (cached) return cached;
  cached = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );
  return cached;
}
