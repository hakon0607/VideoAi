'use client';

import type { MediaAsset } from '@/types/editor';
import { createClient } from '@/lib/supabase/client';
import { newId } from '@/lib/editor/ids';
import { LIBRARY_PREFIX } from './media-source';

export interface LibraryAsset {
  id: string;
  kind: MediaAsset['kind'];
  name: string;
  category: string;
  tags: string[];
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  duration: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  thumbnailUrl: string | null;
  license: string;
  attribution: string | null;
  sourceUrl: string | null;
}

interface LibraryRow {
  id: string;
  kind: string;
  name: string;
  category: string;
  tags: string[];
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number;
  width: number | null;
  height: number | null;
  has_audio: boolean;
  thumbnail_url: string | null;
  license: string;
  attribution: string | null;
  source_url: string | null;
}

function fromRow(row: LibraryRow): LibraryAsset {
  return {
    id: row.id,
    kind: row.kind as MediaAsset['kind'],
    name: row.name,
    category: row.category,
    tags: row.tags ?? [],
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    duration: Number(row.duration_seconds),
    width: row.width,
    height: row.height,
    hasAudio: row.has_audio,
    thumbnailUrl: row.thumbnail_url,
    license: row.license,
    attribution: row.attribution,
    sourceUrl: row.source_url,
  };
}

/** Searches the shared shelf by name and tag. */
export async function searchLibrary(
  query: string,
  kind?: MediaAsset['kind'] | 'all',
): Promise<LibraryAsset[]> {
  const supabase = createClient();
  let request = supabase.from('library_assets').select('*').order('name').limit(120);
  if (kind && kind !== 'all') request = request.eq('kind', kind);
  const trimmed = query.trim();
  if (trimmed) request = request.or(`name.ilike.%${trimmed}%,tags.cs.{${trimmed.toLowerCase()}}`);

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => fromRow(row as unknown as LibraryRow));
}

/**
 * Puts a library file into a project.
 *
 * Nothing is copied: the project's asset row points at the shared file, so a
 * hundred people using the same music track still costs one file. The row is
 * what makes the clip's foreign key valid, and the licence travels with it so
 * the credit can be shown wherever the clip ends up.
 */
export async function addLibraryAssetToProject(
  item: LibraryAsset,
  projectId: string,
  userId: string,
): Promise<MediaAsset> {
  const supabase = createClient();
  const assetId = newId();
  const storagePath = `${LIBRARY_PREFIX}${item.storagePath}`;

  const { error } = await supabase.from('media_assets').insert({
    id: assetId,
    project_id: projectId,
    owner_id: userId,
    kind: item.kind,
    name: item.name,
    storage_path: storagePath,
    mime_type: item.mimeType,
    size_bytes: item.sizeBytes,
    duration_seconds: item.duration,
    width: item.width,
    height: item.height,
    has_audio: item.hasAudio,
    thumbnail_url: item.thumbnailUrl,
    analysis_status: 'basic',
  });
  if (error) throw new Error(error.message);

  return {
    id: assetId,
    projectId,
    folderId: null,
    kind: item.kind,
    name: item.name,
    storagePath,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    duration: item.duration,
    width: item.width,
    height: item.height,
    fps: null,
    hasAudio: item.hasAudio,
    sampleRate: null,
    channels: null,
    waveform: null,
    thumbnailUrl: item.thumbnailUrl,
    analysisStatus: 'basic',
    createdAt: new Date().toISOString(),
  };
}
