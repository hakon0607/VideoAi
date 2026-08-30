'use client';

import type { MediaAnalysis, MediaAsset } from '@/types/editor';
import { createClient } from '@/lib/supabase/client';
import { newId } from '@/lib/editor/ids';
import type { Json } from '@/types/database';
import { analyzeAudio } from './audio';
import { probeImage, probeVideoOrAudio } from './probe';
import { RESUMABLE_THRESHOLD, UploadTooLargeError, getMediaSizeLimit, uploadResumable } from './resumable';
import { putLocalFile, requestPersistence } from './local-store';
import { LOCAL_PREFIX } from './media-source';

/**
 * Where new uploads go.
 *
 * Local is the default, and the reason is money: video is the only genuinely
 * large thing in this app, and hosted storage is priced for it. The browser
 * already holds the file, and everything the editor does — preview, waveform,
 * silence detection, export — reads it from there anyway. Set
 * NEXT_PUBLIC_MEDIA_STORAGE=supabase to put the bytes in the cloud instead,
 * which is what you want if the same account edits from several machines.
 */
export function mediaStorageMode(): 'local' | 'supabase' {
  return process.env.NEXT_PUBLIC_MEDIA_STORAGE === 'supabase' ? 'supabase' : 'local';
}

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

/** The app's own ceiling. The project's bucket limit is usually lower. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;

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
  folderId?: string | null,
): Promise<UploadResult> {
  const kind = classifyFile(file);
  if (!kind) throw new Error(`unsupported_file:${file.type || file.name}`);
  if (file.size > MAX_FILE_BYTES) throw new UploadTooLargeError(file.size, MAX_FILE_BYTES);

  const local = mediaStorageMode() === 'local';

  if (!local) {
    // Check the project's own limit before spending bandwidth on a file the
    // bucket will reject. On the Supabase free plan this is 50 MB by default.
    const limit = await getMediaSizeLimit();
    if (limit !== null && file.size > limit) throw new UploadTooLargeError(file.size, limit);
  }

  const supabase = createClient();
  const assetId = newId();
  const extension = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const storagePath = local
    ? `${LOCAL_PREFIX}${assetId}`
    : `user/${userId}/projects/${projectId}/media/${assetId}.${extension}`;

  onProgress({ stage: 'probing', fraction: 0 });
  const probe = kind === 'image' ? await probeImage(file) : await probeVideoOrAudio(file);

  onProgress({ stage: 'uploading', fraction: 0 });
  const report = (fraction: number) => onProgress({ stage: 'uploading', fraction });
  if (local) {
    // Ask once for storage the browser will not clear behind our back, then
    // write the file. No network, so this is as fast as the disk.
    await requestPersistence();
    await putLocalFile(assetId, file);
    report(1);
  } else if (file.size > RESUMABLE_THRESHOLD) {
    // Big files go up in resumable chunks, so a dropped connection costs one
    // chunk rather than the whole upload.
    await uploadResumable(file, 'media', storagePath, report);
  } else {
    await uploadWithProgress(file, storagePath, report);
  }

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
    folder_id: folderId ?? null,
    analysis_status: 'basic',
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

  const signedUrl = local
    ? URL.createObjectURL(file)
    : (await supabase.storage.from('media').createSignedUrl(storagePath, 60 * 60)).data?.signedUrl ?? null;

  const asset: MediaAsset = {
    id: assetId,
    projectId,
    folderId: folderId ?? null,
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
  return { asset, analysis, signedUrl };
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
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      if (xhr.status === 413) {
        reject(new Error('storage_limit'));
        return;
      }
      // Storage answers with JSON; show its message rather than a bare status.
      let detail = xhr.responseText.slice(0, 300);
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        detail = body.message ?? body.error ?? detail;
      } catch {
        // Not JSON; the raw text is the best we have.
      }
      reject(new Error(`Upload failed (${xhr.status}): ${detail}`));
    };
    xhr.onerror = () => reject(new Error('Upload failed: the network request was blocked or interrupted.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));

    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    xhr.send(form);
  });
}
