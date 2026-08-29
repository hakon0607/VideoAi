'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { isLocale } from '@/lib/i18n/dictionaries';

export interface ProfileResult {
  ok: boolean;
  error?: string;
  field?: 'username' | 'display_name' | 'locale';
}

export async function updateProfileAction(input: {
  username: string;
  displayName: string;
  locale: string;
}): Promise<ProfileResult> {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const username = input.username.trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return { ok: false, error: 'Use 3–32 letters, numbers, dots, dashes or underscores.', field: 'username' };
  }
  if (!isLocale(input.locale)) {
    return { ok: false, error: 'Unknown language.', field: 'locale' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      username,
      display_name: input.displayName.trim() || username,
      locale: input.locale,
    })
    .eq('user_id', auth.user.id);

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That username is taken.', field: 'username' };
    return { ok: false, error: error.message };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
