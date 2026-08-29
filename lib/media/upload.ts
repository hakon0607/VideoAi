'use client';

import type { MediaAnalysis, MediaAsset } from '@/types/editor';
import { createClient } from '@/lib/supabase/client';
import { newId } from '@/lib/editor/ids';
import type { Json } from '@/types/database';
import { analyzeAudio } from './audio';
import { probeImage, probeVideoOrAudio } from './probe';

export const ACCEPTED_MIME: Record<string, MediaAsset['kind']> = {
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'video/x-msvideo': 'video',
  'video/avi': 'video',
  'video/x-matroska': 'video',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/aac': 'audio',
  'audio/ogg': 'audio',
  'audio/webm': 'audio',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
};

const EXTENSION_FALLBACK: Record<string, MediaAsset['kind']> = {
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  avi: 'video',
  mkv: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
};

export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export function classifyFile(file: File): MediaAsset['kind'] | null {
  const byMime = ACCEPTED_MIME[file.type.toLowerCase()];
  if (byMime) return byMime;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_FALLBACK[extension] ?? null;
}

export type UploadStage = 'probing' | 'uploading' | 'analyzing' | 'saving' | 'done' | 'failed';

export interface UploadProgress {
  stage: UploadStage;
  /** 0..1 within the current stage. */
  fraction: number;
  message?: string;
}

export interface UploadResult {
  asset: MediaAsset;
  analysis: MediaAnalysis | null;
  signedUrl: string | null;
}

/**
 * Uploads one file and derives everything the editor and the AI need from it:
 * duration, resolution, frame rate, a poster frame, a waveform and the silence
 * map. All of that happens locally — the only network cost is the file itself.
 */
export async function uploadMediaFile(
  file: File,
  projectId: string,
  userId: string,
  onProgress: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  const kind = classifyFile(file);
  if (!kind) throw new Error(`unsupported_file:${file.type || file.name}`);
  if (file.size > MAX_FILE_BYTES) throw new Error('file_too_large');

  const supabase = createClient();
  const assetId = newId();
  const extension = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const storagePath = `user/${userId}/projects/${projectId}/media/${assetId}.${extension}`;

  onProgress({ stage: 'probing', fraction: 0 });
  const probe = kind === 'image' ? await probeImage(file) : await probeVideoOrAudio(file);

  onProgress({ stage: 'uploading', fraction: 0 });
  await uploadWithProgress(file, storagePath, (fraction) =>
    onProgress({ stage: 'uploading', fraction }),
  );

  let analysis: MediaAnalysis | null = null;
  let waveform: number[] | null = null;
  if (kind !== 'image' && probe.hasAudio) {
    onProgress({ stage: 'analyzing', fraction: 0 });
    try {
      const audio = await analyzeAudio(file, probe.duration, undefined, (fraction) =>
        onProgress({ stage: 'analyzing', fraction }),
      );
      if (audio) {
        waveform = audio.waveform;
        analysis = {
          assetId,
          language: null,
          text: null,
          words: [],
          segments: [],
          silences: audio.silences,
          loudnessDb: audio.loudnessDb,
          createdAt: new Date().toISOString(),
        };
      }
    } catch {
      // Waveform and silence data are a bonus; a failure here must not lose
      // the upload the user already paid for in bandwidth.
    }
  }

  onProgress({ stage: 'saving', fraction: 0 });
  const { error: insertError } = await supabase.from('media_assets').insert({
    id: assetId,
    project_id: projectId,
    owner_id: userId,
    kind,
    name: file.name,
    storage_path: storagePath,
    mime_type: file.type || `${kind}/unknown`,
    size_bytes: file.size,
    duration_seconds: probe.duration,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    has_audio: probe.hasAudio,
    sample_rate: probe.sampleRate,
    channels: probe.channels,
    waveform: waveform as unknown as Json,
    thumbnail_url: probe.thumbnail,
    analysis_status: analysis ? 'basic' : 'basic',
  });
  if (insertError) throw new Error(insertError.message);

  if (analysis) {
    await supabase.from('media_analysis').upsert({
      asset_id: assetId,
      project_id: projectId,
      silences: analysis.silences as unknown as Json,
      loudness_db: analysis.loudnessDb,
      words: [] as unknown as Json,
      segments: [] as unknown as Json,
    });
  }

  const { data: signed } = await supabase.storage.from('media').createSignedUrl(storagePath, 60 * 60);

  const asset: MediaAsset = {
    id: assetId,
    projectId,
    kind,
    name: file.name,
    storagePath,
    mimeType: file.type || `${kind}/unknown`,
    sizeBytes: file.size,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasAudio: probe.hasAudio,
    sampleRate: probe.sampleRate,
    channels: probe.channels,
    waveform,
    thumbnailUrl: probe.thumbnail,
    analysisStatus: 'basic',
    createdAt: new Date().toISOString(),
  };

  onProgress({ stage: 'done', fraction: 1 });
  return { asset, analysis, signedUrl: signed?.signedUrl ?? null };
}

/**
 * Uploads through a signed upload URL with XHR, which — unlike fetch — reports
 * real progress. A 900 MB file deserves an accurate bar.
 */
async function uploadWithProgress(
  file: File,
  path: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from('media').createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(error?.message ?? 'Could not start the upload.');

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', data.signedUrl, true);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error('Upload failed: the network request was blocked or interrupted.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));

    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    xhr.send(form);
  });
}
