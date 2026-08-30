'use client';

import type { MediaAsset } from '@/types/editor';
import { createClient } from '@/lib/supabase/client';
import { getLocalFile } from './local-store';
import { renderSfxFile } from './sfx';
import { renderMusicFile } from './music';

/**
 * Where a file actually lives, encoded in `storage_path`.
 *
 * `local:`   the bytes are on this machine, in the browser's own storage
 * `sfx:`     a built-in sound effect, synthesised on demand
 * `music:`   a built-in music bed, synthesised on demand
 * `library:` a shared file in the project's public library bucket
 * anything else — a path in the private `media` bucket, as before
 */
export const LOCAL_PREFIX = 'local:';
export const SFX_PREFIX = 'sfx:';
export const MUSIC_PREFIX = 'music:';
export const LIBRARY_PREFIX = 'library:';

export type MediaOrigin = 'local' | 'generated' | 'library' | 'cloud';

export function originOf(storagePath: string): MediaOrigin {
  if (storagePath.startsWith(LOCAL_PREFIX)) return 'local';
  if (storagePath.startsWith(SFX_PREFIX) || storagePath.startsWith(MUSIC_PREFIX)) return 'generated';
  if (storagePath.startsWith(LIBRARY_PREFIX)) return 'library';
  return 'cloud';
}

/**
 * One object URL per asset, for the life of the tab.
 *
 * Resolving twice used to mint a second URL and revoke the first, which is a
 * race with a very unpleasant symptom: whoever held the older URL — the media
 * pool, or the exporter's pre-flight check — was left with a blob that no
 * longer exists, and the failure reads as "Failed to fetch" from somewhere
 * completely unrelated. So a resolved URL is cached and reused, and only
 * released when the asset itself goes away.
 */
const objectUrls = new Map<string, { path: string; url: string }>();
/** Resolutions already in flight, so two callers share one render or read. */
const inFlight = new Map<string, Promise<string | null>>();

function rememberObjectUrl(assetId: string, path: string, url: string): string {
  const previous = objectUrls.get(assetId);
  if (previous && previous.url !== url) URL.revokeObjectURL(previous.url);
  objectUrls.set(assetId, { path, url });
  return url;
}

export function releaseObjectUrl(assetId: string): void {
  const entry = objectUrls.get(assetId);
  if (entry) URL.revokeObjectURL(entry.url);
  objectUrls.delete(assetId);
  inFlight.delete(assetId);
}

/**
 * Resolves one asset to something a <video> element or the exporter can read.
 *
 * Returns null when the file is genuinely not here — a project opened on a
 * different machine, or storage the browser cleared. The editor shows that as
 * "offline" and offers to relink, rather than playing silence and pretending.
 */
export async function resolveAssetUrl(asset: MediaAsset): Promise<string | null> {
  const cached = objectUrls.get(asset.id);
  if (cached && cached.path === asset.storagePath) return cached.url;

  const running = inFlight.get(asset.id);
  if (running) return running;

  const work = resolveUncached(asset);
  inFlight.set(asset.id, work);
  try {
    return await work;
  } finally {
    inFlight.delete(asset.id);
  }
}

async function resolveUncached(asset: MediaAsset): Promise<string | null> {
  const path = asset.storagePath;

  if (path.startsWith(SFX_PREFIX)) {
    const file = await renderSfxFile(path.slice(SFX_PREFIX.length));
    return rememberObjectUrl(asset.id, path, URL.createObjectURL(file));
  }

  if (path.startsWith(MUSIC_PREFIX)) {
    const file = await renderMusicFile(path.slice(MUSIC_PREFIX.length));
    return rememberObjectUrl(asset.id, path, URL.createObjectURL(file));
  }

  if (path.startsWith(LOCAL_PREFIX)) {
    const blob = await getLocalFile(path.slice(LOCAL_PREFIX.length));
    if (!blob) return null;
    return rememberObjectUrl(asset.id, path, URL.createObjectURL(blob));
  }

  if (path.startsWith(LIBRARY_PREFIX)) {
    const supabase = createClient();
    const { data } = supabase.storage.from('library').getPublicUrl(path.slice(LIBRARY_PREFIX.length));
    return data.publicUrl ?? null;
  }

  const supabase = createClient();
  const { data } = await supabase.storage.from('media').createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/** Resolves a whole project's media, and reports what could not be found. */
export async function resolveAllAssetUrls(
  assets: MediaAsset[],
): Promise<{ urls: Record<string, string>; missing: MediaAsset[] }> {
  const urls: Record<string, string> = {};
  const missing: MediaAsset[] = [];

  await Promise.all(
    assets.map(async (asset) => {
      try {
        const url = await resolveAssetUrl(asset);
        if (url) urls[asset.id] = url;
        else missing.push(asset);
      } catch {
        missing.push(asset);
      }
    }),
  );

  return { urls, missing };
}
