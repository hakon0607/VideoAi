import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Service-role client. Bypasses RLS, so it is used only for work that has
 * already been authorised against the user's own session — never to answer a
 * request straight from the browser.
 *
 * This module must never be imported from a client component. The import would
 * fail at build time because the key is not a NEXT_PUBLIC_ variable, but the
 * guard below makes the intent explicit.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. It is required for server-side admin operations.');
  }
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL as string, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function hasServiceRole(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
