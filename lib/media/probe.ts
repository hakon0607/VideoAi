'use client';

import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
} from 'mediabunny';

export interface ProbeResult {
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  sampleRate: number | null;
  channels: number | null;
  /** Small JPEG data URL used as the asset thumbnail. */
  thumbnail: string | null;
}

const THUMBNAIL_WIDTH = 320;

/**
 * Reads real metadata out of the container rather than guessing from the file
 * name. Uses mediabunny, which demuxes in the browser, so we get an accurate
 * duration and frame rate even for files a <video> element reports lazily.
 */
export async function probeVideoOrAudio(file: File): Promise<ProbeResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);

    const duration = await input.computeDuration();

    let width: number | null = null;
    let height: number | null = null;
    let fps: number | null = null;
    let thumbnail: string | null = null;

    if (videoTrack) {
      width = videoTrack.displayWidth;
      height = videoTrack.displayHeight;
      try {
        const stats = await videoTrack.computePacketStats(120);
        fps = stats.averagePacketRate ? Math.round(stats.averagePacketRate * 1000) / 1000 : null;
      } catch {
        fps = null;
      }
      thumbnail = await grabThumbnail(videoTrack, duration);
    }

    return {
      duration,
      width,
      height,
      fps,
      hasAudio: Boolean(audioTrack),
      sampleRate: audioTrack?.sampleRate ?? null,
      channels: audioTrack?.numberOfChannels ?? null,
      thumbnail,
    };
  } finally {
    input.dispose();
  }
}

async function grabThumbnail(
  videoTrack: Awaited<ReturnType<Input['getPrimaryVideoTrack']>>,
  duration: number,
): Promise<string | null> {
  if (!videoTrack) return null;
  try {
    const height = Math.max(
      2,
      Math.round((THUMBNAIL_WIDTH * videoTrack.displayHeight) / Math.max(1, videoTrack.displayWidth)),
    );
    const sink = new CanvasSink(videoTrack, { width: THUMBNAIL_WIDTH, height, fit: 'contain' });
    const wrapped = await sink.getCanvas(Math.min(1, duration * 0.1));
    if (!wrapped) return null;
    const canvas = wrapped.canvas;
    if (canvas instanceof HTMLCanvasElement) return canvas.toDataURL('image/jpeg', 0.7);
    const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

export async function probeImage(file: File): Promise<ProbeResult> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, THUMBNAIL_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const result: ProbeResult = {
    duration: 0,
    width: bitmap.width,
    height: bitmap.height,
    fps: null,
    hasAudio: false,
    sampleRate: null,
    channels: null,
    thumbnail: canvas.toDataURL('image/jpeg', 0.75),
  };
  bitmap.close();
  return result;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
