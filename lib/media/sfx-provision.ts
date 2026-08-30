'use client';

import { SFX_PATH_PREFIX } from '@/lib/editor/actions/sfx';
import { MUSIC_PATH_PREFIX } from '@/lib/editor/actions/music';
import { createClient } from '@/lib/supabase/client';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { resolveAssetUrl } from './media-source';

/**
 * Makes the built-in sounds real, without storing a single byte.
 *
 * A sound effect or music bed added to the timeline is a pure editor action: it
 * puts an asset in the project whose path is `sfx:whoosh` or `music:lofi_chill`
 * and nothing else. That is deliberate — the same command has to work on the
 * server when the assistant plans an edit, where there is no audio engine.
 *
 * The synthesis is deterministic, so the path *is* the file: any machine that
 * sees `sfx:whoosh` can render exactly the same waveform. Nothing is uploaded,
 * nothing expires, and the same project sounds identical everywhere.
 *
 * The only thing that has to reach the database is the row itself, because a
 * clip carries a foreign key to its asset and the save would be rejected
 * without it.
 */

function generatedAssets() {
  return useEditorStore
    .getState()
    .state.assets.filter(
      (asset) =>
        asset.storagePath.startsWith(SFX_PATH_PREFIX) || asset.storagePath.startsWith(MUSIC_PATH_PREFIX),
    );
}

/** Generated assets that still have no row in the database. */
export function pendingSoundEffects(): string[] {
  return generatedAssets()
    .filter((asset) => !registered.has(asset.id))
    .map((asset) => asset.id);
}

/** Ids this session has already written a row for. */
const registered = new Set<string>();

/** Renders one generated asset so it plays immediately. */
export async function primeSoundEffectUrl(assetId: string): Promise<void> {
  const asset = useEditorStore.getState().state.assets.find((a) => a.id === assetId);
  if (!asset) return;
  if (useMediaUrls.getState().urls[asset.id]) return;
  try {
    const url = await resolveAssetUrl(asset);
    if (url) useMediaUrls.getState().add(asset.id, url);
  } catch {
    // Nothing to fall back to; the panel shows the clip as silent.
  }
}

/**
 * Writes the database rows for the generated assets a project is using.
 *
 * Idempotent, and safe to call from several places at once — a duplicate id is
 * treated as success, because it means another tab got there first.
 */
export async function ensureSoundEffectsPlayable(projectId: string, userId: string): Promise<void> {
  const pending = generatedAssets().filter((asset) => !registered.has(asset.id));
  if (pending.length === 0) return;

  await Promise.all(pending.map((asset) => primeSoundEffectUrl(asset.id)));

  const supabase = createClient();
  const rows = pending.map((asset) => ({
    id: asset.id,
    project_id: projectId,
    owner_id: userId,
    kind: 'audio' as const,
    name: asset.name,
    storage_path: asset.storagePath,
    mime_type: 'audio/wav',
    size_bytes: 0,
    duration_seconds: asset.duration,
    has_audio: true,
    sample_rate: 44100,
    channels: 1,
    analysis_status: 'basic' as const,
  }));

  const { error } = await supabase.from('media_assets').upsert(rows, { onConflict: 'id' });
  if (error && error.code !== '23505') throw new Error(error.message);
  for (const asset of pending) registered.add(asset.id);
}
