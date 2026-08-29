import type { Clip, MediaClip } from '@/types/editor';

/** Rounds to microseconds so float drift never leaks into the timeline. */
export function q(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e6;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clipEnd(clip: Clip): number {
  return q(clip.start + clip.duration);
}

/** How much of the source asset this clip consumes, in source seconds. */
export function sourceSpan(clip: MediaClip): number {
  return q(clip.duration * clip.speed);
}

/**
 * Maps a timeline timestamp to a timestamp inside the source asset.
 * Returns null when the timestamp is outside the clip.
 */
export function timelineToSource(clip: MediaClip, timelineTime: number): number | null {
  if (timelineTime < clip.start || timelineTime > clipEnd(clip)) return null;
  const local = timelineTime - clip.start;
  if (clip.freeze) return q(clip.sourceIn);
  const span = sourceSpan(clip);
  if (clip.reversed) return q(clip.sourceIn + span - local * clip.speed);
  return q(clip.sourceIn + local * clip.speed);
}

/** Snaps a time to the nearest frame boundary. */
export function snapToFrame(time: number, fps: number): number {
  return q(Math.round(time * fps) / fps);
}

export function formatTimecode(seconds: number, fps = 30): string {
  const safe = Math.max(0, seconds);
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}` : `${pad(m)}:${pad(s)}:${pad(frames)}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const s = safe % 60;
  const m = Math.floor(safe / 60) % 60;
  const h = Math.floor(safe / 3600);
  if (h > 0) return `${h}t ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
