'use client';

import type { MediaAsset } from '@/types/editor';

/**
 * Keeps the uploaded File around for the session so analysis and transcription
 * do not have to download what the browser already has. After a reload the file
 * is fetched back from storage on demand.
 */
const cache = new Map<string, File>();

export function rememberFile(assetId: string, file: File): void {
  cache.set(assetId, file);
}

export function forgetFile(assetId: string): void {
  cache.delete(assetId);
}

export async function getAssetFile(asset: MediaAsset, signedUrl: string | undefined): Promise<File> {
  const cached = cache.get(asset.id);
  if (cached) return cached;
  if (!signedUrl) throw new Error('missing_media_url');
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error(`Could not download the media (${response.status}).`);
  const blob = await response.blob();
  const file = new File([blob], asset.name, { type: asset.mimeType || blob.type });
  cache.set(asset.id, file);
  return file;
}
