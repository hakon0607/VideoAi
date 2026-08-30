'use client';

import type { MediaAsset } from '@/types/editor';
import { SFX_PATH_PREFIX } from '@/lib/editor/actions/sfx';
import { createClient } from '@/lib/supabase/client';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { rememberFile } from './file-cache';
import { renderSfxFile } from './sfx';

/** The assets in the project that are still placeholders. */
export function pendingSoundEffects(): string[] {
  return useEditorStore
    .getState()
    .state.assets.filter((asset) => asset.storagePath.startsWith(SFX_PATH_PREFIX))
    .map((asset) => asset.id);
}

/**
 * Turns placeholder sound-effect assets into real files.
 *
 * The editor actions stay pure: adding a whoosh puts an asset in the project
 * state with the path `sfx:whoosh` and nothing else. This is the step that
 * renders the waveform, uploads it, writes the database row and hands back a
 * URL — so the sound plays in the preview and lands in the exported file like
 * any other upload.
 *
 * Idempotent: an asset already pointing at a real path is skipped.
 */
export async function provisionSoundEffects(projectId: string, userId: string): Promise<{ provisioned: number; failed: string[] }> {
  const pending = useEditorStore
    .getState()
    .state.assets.filter((asset) => asset.storagePath.startsWith(SFX_PATH_PREFIX));

  if (pending.length === 0) return { provisioned: 0, failed: [] };

  const supabase = createClient();
  const failed: string[] = [];
  let provisioned = 0;

  for (const asset of pending) {
    const soundId = asset.storagePath.slice(SFX_PATH_PREFIX.length);
    try {
      const file = await renderSfxFile(soundId);
      const storagePath = `user/${userId}/projects/${projectId}/media/${asset.id}.wav`;

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(storagePath, file, { upsert: true, contentType: 'audio/wav' });
      if (uploadError) throw new Error(uploadError.message);

      const { error: insertError } = await supabase.from('media_assets').insert({
        id: asset.id,
        project_id: projectId,
        owner_id: userId,
        kind: 'audio',
        name: asset.name,
        storage_path: storagePath,
        mime_type: 'audio/wav',
        size_bytes: file.size,
        duration_seconds: asset.duration,
        has_audio: true,
        sample_rate: 44100,
        channels: 1,
        analysis_status: 'basic',
      });
      // A duplicate id means another tab already provisioned it, which is fine.
      if (insertError && insertError.code !== '23505') throw new Error(insertError.message);

      const { data: signed } = await supabase.storage.from('media').createSignedUrl(storagePath, 60 * 60);

      rememberFile(asset.id, file);
      useEditorStore.getState().patchAsset(asset.id, { storagePath, sizeBytes: file.size });
      if (signed?.signedUrl) useMediaUrls.getState().add(asset.id, signed.signedUrl);
      provisioned += 1;
    } catch (error) {
      failed.push(`${soundId}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return { provisioned, failed };
}

/**
 * A local object URL for a sound, so it is audible the instant it is added
 * rather than after the upload round trip.
 */
export async function primeSoundEffectUrl(asset: MediaAsset): Promise<void> {
  if (!asset.storagePath.startsWith(SFX_PATH_PREFIX)) return;
  if (useMediaUrls.getState().urls[asset.id]) return;
  try {
    const file = await renderSfxFile(asset.storagePath.slice(SFX_PATH_PREFIX.length));
    rememberFile(asset.id, file);
    useMediaUrls.getState().add(asset.id, URL.createObjectURL(file));
  } catch {
    // The upload path will supply a URL shortly; silence here is correct.
  }
}

/**
 * Gives every pending sound a local URL, then uploads them.
 *
 * Single-flight: a sound added by the assistant, one added from the panel and
 * the autosave that follows all wait on the same run rather than racing to
 * upload the same file three times. The save has to wait for this, because a
 * clip whose asset has no database row cannot be stored at all.
 */
let inFlight: Promise<void> | null = null;

export async function ensureSoundEffectsPlayable(projectId: string, userId: string): Promise<void> {
  if (inFlight) {
    await inFlight;
    // Another sound may have been added while that run was in the air.
    if (pendingSoundEffects().length === 0) return;
  }
  const run = (async () => {
    const pending = useEditorStore
      .getState()
      .state.assets.filter((asset) => asset.storagePath.startsWith(SFX_PATH_PREFIX));
    if (pending.length === 0) return;
    await Promise.all(pending.map(primeSoundEffectUrl));
    await provisionSoundEffects(projectId, userId);
  })();
  inFlight = run;
  try {
    await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}
