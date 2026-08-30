'use client';

import {
  ALL_FORMATS,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  UrlSource,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type Quality,
} from 'mediabunny';
import type { EditorState, ExportQuality, ExportSettings, MediaClip } from '@/types/editor';
import { isMediaClip } from '@/types/editor';
import { clipEnd } from '@/lib/editor/time';
import { timelineDuration } from '@/lib/editor/selectors';
import { clipRenderWindow, composeFrame, type Drawable, type FrameProvider } from './compose';
import { AudioSourcePool, hasAudio, renderAudioSegment } from './audio-mixer';

const QUALITY_MAP: Record<ExportQuality, Quality> = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  very_high: QUALITY_VERY_HIGH,
};

const AUDIO_SEGMENT_SECONDS = 30;

export interface ExportProgress {
  stage: 'preparing' | 'video' | 'audio' | 'finalizing';
  fraction: number;
  frame?: number;
  totalFrames?: number;
}

export class ExportUnsupportedError extends Error {
  readonly code = 'export_unsupported';
}

export class ExportCancelledError extends Error {
  readonly code = 'export_cancelled';
}

/** Whether this browser can encode video at all. */
export async function checkExportSupport(): Promise<{ supported: boolean; codec: 'avc' | 'vp9' | null }> {
  if (typeof window === 'undefined' || typeof VideoEncoder === 'undefined') {
    return { supported: false, codec: null };
  }
  if (await canEncodeVideo('avc')) return { supported: true, codec: 'avc' };
  if (await canEncodeVideo('vp9')) return { supported: true, codec: 'vp9' };
  return { supported: false, codec: null };
}

/**
 * Supplies decoded frames to the compositor during an export.
 *
 * Each clip gets its own decoder stream, pulled in the order the output frames
 * need it. That keeps decoding sequential — the fast path for every codec —
 * instead of seeking backwards and forwards per frame.
 */
class ExportFrameProvider implements FrameProvider {
  private inputs = new Map<string, Input>();
  private sinks = new Map<string, CanvasSink>();
  private iterators = new Map<string, AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null>>();
  private current = new Map<string, Drawable>();
  private sizes = new Map<string, { width: number; height: number }>();
  private images = new Map<string, ImageBitmap>();

  constructor(
    private state: EditorState,
    private urls: Record<string, string>,
  ) {}

  /** Names of clips this browser cannot decode. Checked before rendering. */
  readonly undecodable: string[] = [];

  async prepare(times: number[]): Promise<void> {
    for (const clip of this.state.clips) {
      if (!isMediaClip(clip) || clip.kind === 'audio') continue;
      const url = this.urls[clip.assetId];
      if (!url) continue;

      if (clip.kind === 'image') {
        if (!this.images.has(clip.assetId)) {
          const response = await fetch(url);
          const blob = await response.blob();
          const bitmap = await createImageBitmap(blob);
          this.images.set(clip.assetId, bitmap);
          this.sizes.set(clip.id, { width: bitmap.width, height: bitmap.height });
        }
        continue;
      }

      const input = this.inputs.get(clip.assetId) ?? new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
      this.inputs.set(clip.assetId, input);
      const track = await input.getPrimaryVideoTrack();
      if (!track) continue;

      // Ask before decoding: a browser without, say, H.265 support should say
      // so by name rather than fail with an opaque decoder error mid-render.
      if (!(await track.canDecode())) {
        this.undecodable.push(`${clip.name} (${track.codec ?? 'unknown codec'})`);
        continue;
      }
      this.sizes.set(clip.id, { width: track.displayWidth, height: track.displayHeight });

      const sink = new CanvasSink(track, { poolSize: 2 });
      this.sinks.set(clip.id, sink);

      const timestamps = this.sourceTimestampsFor(clip, times);
      if (timestamps.length === 0) continue;
      const monotonic = timestamps.every((value, i) => i === 0 || value >= timestamps[i - 1]);
      if (monotonic) {
        this.iterators.set(
          clip.id,
          sink.canvasesAtTimestamps(timestamps) as AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null>,
        );
      }
    }
  }

  private sourceTimestampsFor(clip: MediaClip, times: number[]): number[] {
    const window = clipRenderWindow(clip);
    const span = clip.duration * clip.speed;
    const stamps: number[] = [];
    for (const time of times) {
      if (time < window.start || time >= window.end) continue;
      const local = time - clip.start;
      const source = clip.freeze
        ? clip.sourceIn
        : clip.reversed
          ? clip.sourceIn + span - local * clip.speed
          : clip.sourceIn + local * clip.speed;
      stamps.push(Math.max(0, source));
    }
    return stamps;
  }

  /** Advances every active clip to the frame for `time`. */
  async advance(time: number): Promise<void> {
    for (const clip of this.state.clips) {
      if (!isMediaClip(clip) || clip.kind === 'audio') continue;
      if (clip.kind === 'image') {
        const bitmap = this.images.get(clip.assetId);
        if (bitmap) this.current.set(clip.id, bitmap);
        continue;
      }
      const window = clipRenderWindow(clip);
      if (time < window.start || time >= window.end) {
        this.current.delete(clip.id);
        continue;
      }

      const iterator = this.iterators.get(clip.id);
      if (iterator) {
        const next = await iterator.next();
        if (!next.done && next.value) this.current.set(clip.id, next.value.canvas as Drawable);
        continue;
      }

      // Reversed or frozen clips are not monotonic, so they are seeked directly.
      const sink = this.sinks.get(clip.id);
      if (!sink) continue;
      const local = time - clip.start;
      const span = clip.duration * clip.speed;
      const source = clip.freeze
        ? clip.sourceIn
        : clip.reversed
          ? clip.sourceIn + span - local * clip.speed
          : clip.sourceIn + local * clip.speed;
      const wrapped = await sink.getCanvas(Math.max(0, source));
      if (wrapped) this.current.set(clip.id, wrapped.canvas as Drawable);
    }
  }

  getFrame(clip: MediaClip): Drawable | null {
    return this.current.get(clip.id) ?? null;
  }

  getSize(clip: MediaClip): { width: number; height: number } | null {
    return this.sizes.get(clip.id) ?? null;
  }

  dispose(): void {
    for (const input of this.inputs.values()) input.dispose();
    for (const bitmap of this.images.values()) bitmap.close();
    this.inputs.clear();
    this.sinks.clear();
    this.iterators.clear();
    this.images.clear();
  }
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  durationSeconds: number;
}

/**
 * Renders the project to a real video file, in this browser tab.
 *
 * Frames go through the same `composeFrame` the preview uses, so the export is
 * the preview — just at full resolution and with frame-accurate decoding
 * instead of a seeking <video> element.
 */
export async function exportProject(
  state: EditorState,
  urls: Record<string, string>,
  settings: ExportSettings,
  onProgress: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const support = await checkExportSupport();
  if (!support.supported || !support.codec) throw new ExportUnsupportedError('This browser cannot encode video.');

  const total = timelineDuration(state);
  const start = Math.max(0, settings.rangeStart ?? 0);
  const end = Math.min(total, settings.rangeEnd ?? total);
  const duration = end - start;
  if (duration <= 0) throw new Error('empty_timeline');

  onProgress({ stage: 'preparing', fraction: 0 });

  // The composition is authored at the project's own size; exporting at a
  // different size is just a uniform scale of the same drawing.
  const scale = settings.width / state.settings.width;
  const canvas = document.createElement('canvas');
  canvas.width = settings.width;
  canvas.height = settings.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas_unavailable');

  const useWebm = settings.format === 'webm' || support.codec === 'vp9';
  const output = new Output({
    format: useWebm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const quality = QUALITY_MAP[settings.quality];
  const videoSource = new CanvasSource(canvas, {
    codec: useWebm ? 'vp9' : 'avc',
    quality,
  });
  output.addVideoTrack(videoSource, { frameRate: settings.fps });

  const wantsAudio = settings.includeAudio && hasAudio(state);
  const audioCodec = useWebm ? 'opus' : 'aac';
  const canAudio = wantsAudio && (await canEncodeAudio(audioCodec));
  let audioSource: AudioBufferSource | null = null;
  if (canAudio) {
    // Sample rate and channel count come from the AudioBuffer we hand it.
    audioSource = new AudioBufferSource({ codec: audioCodec, quality });
    output.addAudioTrack(audioSource);
  }

  await output.start();

  const frameCount = Math.max(1, Math.round(duration * settings.fps));
  const times = Array.from({ length: frameCount }, (_, i) => start + i / settings.fps);

  const provider = new ExportFrameProvider(state, urls);
  const audioPool = new AudioSourcePool(urls);

  try {
    await provider.prepare(times);
    if (provider.undecodable.length > 0) {
      throw new ExportUnsupportedError(
        `This browser cannot decode ${provider.undecodable.join(', ')}. Try Chrome or Edge, or re-encode the file as H.264 MP4.`,
      );
    }

    for (let i = 0; i < frameCount; i += 1) {
      if (signal?.aborted) throw new ExportCancelledError('Export cancelled.');
      const time = times[i];
      await provider.advance(time);

      ctx.save();
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      composeFrame(ctx, state, time, provider);
      ctx.restore();

      await videoSource.add(i / settings.fps, 1 / settings.fps);
      if (i % 5 === 0 || i === frameCount - 1) {
        onProgress({
          stage: 'video',
          fraction: (i + 1) / frameCount,
          frame: i + 1,
          totalFrames: frameCount,
        });
      }
    }
    videoSource.close();

    if (audioSource) {
      const segments = Math.ceil(duration / AUDIO_SEGMENT_SECONDS);
      for (let i = 0; i < segments; i += 1) {
        if (signal?.aborted) throw new ExportCancelledError('Export cancelled.');
        const segStart = start + i * AUDIO_SEGMENT_SECONDS;
        const segEnd = Math.min(end, segStart + AUDIO_SEGMENT_SECONDS);
        const buffer = await renderAudioSegment(state, audioPool, { start: segStart, end: segEnd }, state.settings.sampleRate);
        await audioSource.add(buffer);
        onProgress({ stage: 'audio', fraction: (i + 1) / segments });
      }
      audioSource.close();
    }

    onProgress({ stage: 'finalizing', fraction: 1 });
    await output.finalize();

    const target = output.target as BufferTarget;
    if (!target.buffer) throw new Error('export_produced_no_data');
    const blob = new Blob([target.buffer], { type: useWebm ? 'video/webm' : 'video/mp4' });
    const safeName = state.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'video';

    return {
      blob,
      fileName: `${safeName}.${useWebm ? 'webm' : 'mp4'}`,
      durationSeconds: duration,
    };
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    provider.dispose();
    audioPool.dispose();
  }
}

/**
 * Pre-flight decodability check, so the export dialog can warn before the user
 * commits to a render rather than failing halfway through.
 */
export async function checkProjectDecodable(
  state: EditorState,
  urls: Record<string, string>,
): Promise<string[]> {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const clip of state.clips) {
    if (!isMediaClip(clip) || clip.kind === 'image' || seen.has(clip.assetId)) continue;
    seen.add(clip.assetId);
    const url = urls[clip.assetId];
    if (!url) continue;
    // Constructing the Input can throw on its own for an unreachable URL, so it
    // belongs inside the try: this is a pre-flight check, and a check that
    // throws is worse than no check.
    let input: Input | null = null;
    try {
      input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
      const track = clip.kind === 'audio' ? await input.getPrimaryAudioTrack() : await input.getPrimaryVideoTrack();
      if (track && !(await track.canDecode())) {
        problems.push(`${clip.name} (${track.codec ?? 'unknown codec'})`);
      }
    } catch {
      problems.push(clip.name);
    } finally {
      input?.dispose();
    }
  }
  return problems;
}

/** Clips that will not render because their media could not be resolved. */
export function missingMediaFor(state: EditorState, urls: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const clip of state.clips) {
    if (isMediaClip(clip) && !urls[clip.assetId]) missing.add(clip.name);
  }
  return [...missing];
}

export function clipsOutsideRange(state: EditorState, start: number, end: number): number {
  return state.clips.filter((clip) => clipEnd(clip) <= start || clip.start >= end).length;
}
