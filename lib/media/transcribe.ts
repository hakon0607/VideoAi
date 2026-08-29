'use client';

import type { MediaAnalysis, TranscriptSegment, TranscriptWord } from '@/types/editor';
import { extractWavChunks } from './audio';

export interface TranscribeProgress {
  stage: 'extracting' | 'uploading' | 'done';
  fraction: number;
  chunk?: number;
  chunks?: number;
}

export class InsufficientCreditsError extends Error {
  readonly detail: unknown;
  constructor(detail: unknown) {
    super('insufficient_credits');
    this.name = 'InsufficientCreditsError';
    this.detail = detail;
  }
}

/**
 * Sends the asset's audio for transcription, chunk by chunk.
 *
 * Only the first chunk is charged, so a long file costs the same as a short
 * one. Word timestamps come back on the timeline's terms, which is what makes
 * "cut where I say ehm" and real captions possible.
 */
export async function transcribeAsset(
  file: File,
  assetId: string,
  projectId: string,
  onProgress: (progress: TranscribeProgress) => void,
  language?: string,
): Promise<MediaAnalysis> {
  const chunks: { blob: Blob; offset: number }[] = [];
  for await (const chunk of extractWavChunks(file, (fraction) =>
    onProgress({ stage: 'extracting', fraction }),
  )) {
    chunks.push({ blob: chunk.blob, offset: chunk.offset });
  }

  if (chunks.length === 0) throw new Error('no_audio');

  let words: TranscriptWord[] = [];
  let segments: TranscriptSegment[] = [];
  let text = '';
  let detectedLanguage: string | null = null;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const form = new FormData();
    form.append('file', new File([chunk.blob], `chunk-${i}.wav`, { type: 'audio/wav' }));
    form.append('assetId', assetId);
    form.append('projectId', projectId);
    form.append('offset', String(chunk.offset));
    form.append('isFirst', String(i === 0));
    form.append('isLast', String(i === chunks.length - 1));
    if (language) form.append('language', language);

    const response = await fetch('/api/media/transcribe', { method: 'POST', body: form });
    if (response.status === 402) {
      const body = await response.json().catch(() => ({}));
      throw new InsufficientCreditsError(body.detail ?? null);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? `Transcription failed (${response.status})`);
    }
    const body = (await response.json()) as {
      words: TranscriptWord[];
      segments: TranscriptSegment[];
      text: string;
      language: string | null;
    };
    words = body.words;
    segments = body.segments;
    text = body.text;
    detectedLanguage = body.language;
    onProgress({ stage: 'uploading', fraction: (i + 1) / chunks.length, chunk: i + 1, chunks: chunks.length });
  }

  onProgress({ stage: 'done', fraction: 1 });
  return {
    assetId,
    language: detectedLanguage,
    text,
    words,
    segments,
    silences: [],
    loudnessDb: null,
    createdAt: new Date().toISOString(),
  };
}
