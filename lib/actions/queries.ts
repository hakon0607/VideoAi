import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ProjectSummary } from '@/components/dashboard/project-card';

export interface ProfileRow {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  locale: string;
  is_admin: boolean;
}

export async function loadProfile() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('username, display_name, avatar_url, locale, is_admin')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  return { user: auth.user, profile: (data as ProfileRow | null) ?? null };
}

/** Projects plus freshly signed thumbnail URLs, ready for the dashboard grid. */
export async function loadProjects(limit = 60): Promise<ProjectSummary[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, aspect_ratio, duration_seconds, created_at, updated_at, thumbnail_path')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const paths = data.map((p) => p.thumbnail_path).filter((p): p is string => Boolean(p));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await supabase.storage.from('media').createSignedUrls(paths, 60 * 60);
    for (const item of urls ?? []) {
      if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
    }
  }

  return data.map((p) => ({
    id: p.id,
    name: p.name,
    aspectRatio: p.aspect_ratio,
    durationSeconds: Number(p.duration_seconds ?? 0),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    thumbnailUrl: p.thumbnail_path ? (signed.get(p.thumbnail_path) ?? null) : null,
  }));
}
