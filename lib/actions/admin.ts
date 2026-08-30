'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { parseStoragePaths, removePaths, removePrefix } from '@/lib/storage/cleanup';
import type { Views } from '@/types/database';

export interface AdminResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/**
 * Every admin action re-checks admin status server-side. The database functions
 * check it again independently, so a stale session or a hand-crafted request
 * still gets nowhere.
 */
async function requireAdmin() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!profile?.is_admin) redirect('/dashboard');
  return { supabase, user: auth.user };
}

export interface AdminOverview {
  users: number;
  admins: number;
  projects: number;
  assets: number;
  bytesUsed: number;
  clips: number;
  aiRequests: number;
  aiEdits: number;
  exports: number;
  creditsSpent: number;
  activeToday: number;
  signupsWeek: number;
}

export interface AdminData {
  overview: AdminOverview;
  users: Views<'admin_users'>[];
  projects: Views<'admin_projects'>[];
  media: Views<'admin_media'>[];
  activity: Views<'admin_credit_activity'>[];
  costs: { key: string; cost: number; description: string }[];
  hasServiceRole: boolean;
  currentUserId: string;
}

const EMPTY_OVERVIEW: AdminOverview = {
  users: 0,
  admins: 0,
  projects: 0,
  assets: 0,
  bytesUsed: 0,
  clips: 0,
  aiRequests: 0,
  aiEdits: 0,
  exports: 0,
  creditsSpent: 0,
  activeToday: 0,
  signupsWeek: 0,
};

function parseOverview(value: unknown): AdminOverview {
  if (!value || typeof value !== 'object') return EMPTY_OVERVIEW;
  const raw = value as Record<string, unknown>;
  const num = (key: keyof AdminOverview) => Number(raw[key] ?? 0);
  return {
    users: num('users'),
    admins: num('admins'),
    projects: num('projects'),
    assets: num('assets'),
    bytesUsed: num('bytesUsed'),
    clips: num('clips'),
    aiRequests: num('aiRequests'),
    aiEdits: num('aiEdits'),
    exports: num('exports'),
    creditsSpent: num('creditsSpent'),
    activeToday: num('activeToday'),
    signupsWeek: num('signupsWeek'),
  };
}

/** Everything the admin panel shows, in one round trip. */
export async function loadAdminData(): Promise<AdminData> {
  const { supabase, user } = await requireAdmin();

  const [overview, users, projects, media, activity, costs] = await Promise.all([
    supabase.rpc('admin_overview'),
    supabase.from('admin_users').select('*').order('signed_up_at', { ascending: false }).limit(500),
    supabase.from('admin_projects').select('*').order('updated_at', { ascending: false }).limit(500),
    supabase.from('admin_media').select('*').order('size_bytes', { ascending: false }).limit(500),
    supabase.from('admin_credit_activity').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('credit_costs').select('*').order('key'),
  ]);

  return {
    overview: parseOverview(overview.data),
    users: users.data ?? [],
    projects: projects.data ?? [],
    media: media.data ?? [],
    activity: activity.data ?? [],
    costs: costs.data ?? [],
    hasServiceRole: hasServiceRole(),
    currentUserId: user.id,
  };
}

export async function setUserCreditsAction(input: {
  userId: string;
  balance?: number | null;
  unlimited?: boolean | null;
  refillAmount?: number | null;
  refillHours?: number | null;
}): Promise<AdminResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('admin_set_credits', {
    p_user_id: input.userId,
    p_balance: input.balance ?? null,
    p_unlimited: input.unlimited ?? null,
    p_refill_amount: input.refillAmount ?? null,
    p_refill_hours: input.refillHours ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true, message: 'Credits updated.' };
}

export async function setUserAdminAction(userId: string, isAdmin: boolean): Promise<AdminResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('admin_set_admin', { p_user_id: userId, p_is_admin: isAdmin });
  if (error) {
    return {
      ok: false,
      error: error.message.includes('cannot_change_own_admin_flag')
        ? 'You cannot change your own admin flag.'
        : error.message,
    };
  }
  revalidatePath('/admin');
  return { ok: true, message: isAdmin ? 'Promoted to admin.' : 'Admin access removed.' };
}

export async function setCreditCostAction(key: string, cost: number): Promise<AdminResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('admin_set_credit_cost', { p_key: key, p_cost: cost });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true, message: 'Price updated.' };
}

/**
 * Deletes any user's project and the files behind it.
 *
 * The rows go through RLS-checked admin functions; the storage objects belong
 * to another user's folder, so removing them needs the service role. Without
 * that key the rows are still deleted and the caller is told the files remain.
 */
export async function deleteProjectAsAdminAction(projectId: string): Promise<AdminResult> {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase.rpc('admin_delete_project', { p_project_id: projectId });
  if (error) return { ok: false, error: error.message };

  const paths = parseStoragePaths(data);
  const name = (data as { name?: string } | null)?.name ?? 'the project';

  if (!hasServiceRole()) {
    revalidatePath('/admin');
    return {
      ok: true,
      message: `Deleted "${name}", but its files are still in storage: SUPABASE_SERVICE_ROLE_KEY is not set.`,
    };
  }

  try {
    const admin = createAdminClient();
    await removePaths(admin, 'media', paths.mediaPaths);
    await removePaths(admin, 'exports', paths.exportPaths);
    for (const path of paths.mediaPaths.slice(0, 1)) {
      // media paths look like user/{ownerId}/projects/{projectId}/media/{file}
      const owner = path.split('/')[1];
      if (owner) {
        await removePrefix(admin, 'media', `user/${owner}/projects/${projectId}`);
        await removePrefix(admin, 'exports', `user/${owner}/projects/${projectId}`);
      }
    }
  } catch (cleanupError) {
    revalidatePath('/admin');
    return {
      ok: true,
      message: `Deleted "${name}", but storage cleanup failed: ${
        cleanupError instanceof Error ? cleanupError.message : 'unknown error'
      }`,
    };
  }

  revalidatePath('/admin');
  revalidatePath('/dashboard');
  return { ok: true, message: `Deleted "${name}" and freed its storage.` };
}

export interface OrphanedFile {
  bucket: string;
  path: string;
  size: number | null;
}

/** Files left in a bucket with no row pointing at them. */
export async function findOrphanedFilesAction(): Promise<{ files: OrphanedFile[]; error?: string }> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc('admin_orphaned_paths');
  if (error) return { files: [], error: error.message };
  return { files: Array.isArray(data) ? (data as unknown as OrphanedFile[]) : [] };
}

export async function deleteOrphanedFilesAction(files: OrphanedFile[]): Promise<AdminResult> {
  await requireAdmin();
  if (!hasServiceRole()) {
    return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set, so files in other users’ folders cannot be removed.' };
  }
  try {
    const admin = createAdminClient();
    const byBucket = new Map<string, string[]>();
    for (const file of files) {
      byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
    }
    for (const [bucket, paths] of byBucket) await removePaths(admin, bucket, paths);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Cleanup failed.' };
  }
  revalidatePath('/admin');
  return { ok: true, message: `Removed ${files.length} orphaned file${files.length === 1 ? '' : 's'}.` };
}
