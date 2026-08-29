'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { PROJECT_PRESETS } from '@/lib/editor/defaults';

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

  // Remove the stored media first; the database rows cascade from the project.
  const { data: assets } = await supabase
    .from('media_assets')
    .select('storage_path')
    .eq('project_id', projectId);

  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) return { ok: false, error: error.message };

  if (assets?.length) {
    // A duplicated project shares storage objects, so only delete files that no
    // surviving asset row still points at.
    const paths = assets.map((a) => a.storage_path);
    const { data: stillUsed } = await supabase
      .from('media_assets')
      .select('storage_path')
      .in('storage_path', paths);
    const used = new Set((stillUsed ?? []).map((a) => a.storage_path));
    const orphaned = paths.filter((p) => !used.has(p) && p.startsWith(`user/${user.id}/`));
    if (orphaned.length) await supabase.storage.from('media').remove(orphaned);
  }

  revalidatePath('/dashboard');
  revalidatePath('/projects');
  return { ok: true };
}

export async function touchProjectAction(projectId: string): Promise<void> {
  const { supabase } = await requireUser();
  await supabase.from('projects').update({ last_opened_at: new Date().toISOString() }).eq('id', projectId);
}
