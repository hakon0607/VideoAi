'use client';

import * as tus from 'tus-js-client';
import { createClient } from '@/lib/supabase/client';

/** Supabase's resumable endpoint requires exactly 6 MB chunks. */
const CHUNK_SIZE = 6 * 1024 * 1024;

/** Above this size a plain upload is fragile; use the resumable protocol. */
export const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;

export class UploadTooLargeError extends Error {
  readonly limitBytes: number;
  readonly fileBytes: number;
  constructor(fileBytes: number, limitBytes: number) {
    super('file_too_large');
    this.name = 'UploadTooLargeError';
    this.fileBytes = fileBytes;
    this.limitBytes = limitBytes;
  }
}

let cachedLimit: number | null | undefined;

/**
 * The bucket's configured maximum file size.
 *
 * Supabase enforces this per project, and on the free plan it defaults to
 * 50 MB — which is the usual reason a large upload fails. Reading it lets the
 * app say exactly what the limit is instead of surfacing a raw 413.
 */
export async function getMediaSizeLimit(): Promise<number | null> {
  if (cachedLimit !== undefined) return cachedLimit ?? null;
  try {
    const supabase = createClient();
    const { data } = await supabase.storage.getBucket('media');
    cachedLimit = data?.file_size_limit ? Number(data.file_size_limit) : null;
  } catch {
    cachedLimit = null;
  }
  return cachedLimit ?? null;
}

/**
 * Uploads a large file with the resumable (TUS) protocol.
 *
 * A single PUT of a 900 MB file dies on any network blip and reports nothing
 * useful along the way. TUS uploads it in 6 MB chunks, retries the chunk rather
 * than the file, and gives real progress.
 */
export async function uploadResumable(
  file: File,
  bucket: string,
  path: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Your session expired. Sign in again and retry the upload.');

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${projectUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 6000, 12000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-upsert': 'true',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      chunkSize: CHUNK_SIZE,
      onProgress: (sent, total) => onProgress(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        // TUS wraps the HTTP response; pull the useful part out of it.
        if (message.includes('413') || message.toLowerCase().includes('exceeded the maximum')) {
          reject(new Error('storage_limit'));
          return;
        }
        reject(new Error(message));
      },
    });

    signal?.addEventListener('abort', () => {
      void upload.abort(true);
      reject(new Error('cancelled'));
    });

    // Resume an interrupted upload of the same file rather than starting over.
    void upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    });
  });
}
