'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { PROJECT_PRESETS } from '@/lib/editor/defaults';
import { parseStoragePaths, removePaths, removePrefix } from '@/lib/storage/cleanup';

export interface ActionResult {
  ok: boolean;
  error?: string;
  projectId?: string;
}

async function requireUser() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  return { supabase, user: data.user };
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const name = (formData.get('name') as string | null)?.trim() || 'Untitled project';
  const presetId = (formData.get('preset') as string | null) ?? 'youtube_1080p';
  const preset = PROJECT_PRESETS.find((p) => p.id === presetId) ?? PROJECT_PRESETS[0];

  const { data, error } = await supabase.rpc('create_project', {
    p_name: name,
    p_aspect_ratio: preset.aspectRatio,
    p_width: preset.width,
    p_height: preset.height,
    p_fps: preset.fps,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'Could not create the project.');
  }
  revalidatePath('/dashboard');
  redirect(`/editor/${data}`);
}

export async function renameProjectAction(projectId: string, name: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'A project needs a name.' };
  const { error } = await supabase.from('projects').update({ name: trimmed }).eq('id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard');
  revalidatePath('/projects');
  return { ok: true };
}

export async function duplicateProjectAction(projectId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc('duplicate_project', { p_project_id: projectId });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard');
  revalidatePath('/projects');
  return { ok: true, projectId: data as string };
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();

  // Ask the database which objects only this project references, before the
  // rows disappear. Files shared with a duplicated project are left alone.
  const { data: pathData } = await supabase.rpc('project_storage_paths', { p_project_id: projectId });
  const paths = parseStoragePaths(pathData);

  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) return { ok: false, error: error.message };

  // Then clear the bucket. The folder walk catches anything the rows missed —
  // an interrupted upload, a thumbnail, a stale export.
  try {
    await removePaths(supabase, 'media', paths.mediaPaths);
    await removePaths(supabase, 'exports', paths.exportPaths);
    await removePrefix(supabase, 'media', `user/${user.id}/projects/${projectId}`);
    await removePrefix(supabase, 'exports', `user/${user.id}/projects/${projectId}`);
  } catch {
    // The project is already gone; a storage hiccup must not fail the delete.
    // Anything left behind shows up under Storage in the admin panel.
  }

  revalidatePath('/dashboard');
  revalidatePath('/projects');
  return { ok: true };
}

/** Deletes one media asset and the file behind it, if nothing else uses it. */
export async function deleteAssetAction(assetId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();

  const { data: asset } = await supabase
    .from('media_assets')
    .select('storage_path, project_id')
    .eq('id', assetId)
    .maybeSingle();
  if (!asset) return { ok: false, error: 'That media file no longer exists.' };

  const { error } = await supabase.from('media_assets').delete().eq('id', assetId);
  if (error) return { ok: false, error: error.message };

  // Only delete the object when no surviving row points at it.
  const { count } = await supabase
    .from('media_assets')
    .select('id', { count: 'exact', head: true })
    .eq('storage_path', asset.storage_path);

  if (!count) await removePaths(supabase, 'media', [asset.storage_path]);
  return { ok: true };
}

/**
 * Every asset id this account still owns.
 *
 * With media stored on the editor's own machine, deleting a project somewhere
 * else cannot reach in and remove the files. The browser sweeps its own storage
 * against this list instead, so a deleted project stops taking up disk.
 */
export async function listOwnedAssetIdsAction(): Promise<string[]> {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data } = await supabase.from('media_assets').select('id,storage_path').eq('owner_id', auth.user.id);
  return (data ?? [])
    .filter((row) => String(row.storage_path ?? '').startsWith('local:'))
    .map((row) => String(row.storage_path).slice('local:'.length));
}

export async function touchProjectAction(projectId: string): Promise<void> {
  const { supabase } = await requireUser();
  await supabase.from('projects').update({ last_opened_at: new Date().toISOString() }).eq('id', projectId);
}
