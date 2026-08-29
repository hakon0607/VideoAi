import type { Clip, EditorState } from '@/types/editor';
import { clipEnd } from '@/lib/editor/time';

export const TRACK_HEADER_WIDTH = 148;
export const RULER_HEIGHT = 26;
export const TRACK_GAP = 4;

/** Chooses a readable tick spacing for the current zoom level. */
export function tickInterval(pixelsPerSecond: number): { major: number; minor: number } {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const step of candidates) {
    if (step * pixelsPerSecond >= 72) return { major: step, minor: step / 5 };
  }
  return { major: 900, minor: 180 };
}

export interface SnapTarget {
  time: number;
  kind: 'clip' | 'playhead' | 'origin';
}

/** Every edge worth snapping to, excluding the clips being dragged. */
export function snapTargets(state: EditorState, playhead: number, excludeIds: Set<string>): SnapTarget[] {
  const targets: SnapTarget[] = [
    { time: 0, kind: 'origin' },
    { time: playhead, kind: 'playhead' },
  ];
  for (const clip of state.clips) {
    if (excludeIds.has(clip.id)) continue;
    targets.push({ time: clip.start, kind: 'clip' });
    targets.push({ time: clipEnd(clip), kind: 'clip' });
  }
  return targets;
}

/** Snaps `time` to the nearest target within `thresholdPx`. */
export function snapTime(
  time: number,
  targets: SnapTarget[],
  pixelsPerSecond: number,
  thresholdPx = 7,
): { time: number; snappedTo: number | null } {
  let best: number | null = null;
  let bestDistance = thresholdPx / pixelsPerSecond;
  for (const target of targets) {
    const distance = Math.abs(target.time - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target.time;
    }
  }
  return best === null ? { time, snappedTo: null } : { time: best, snappedTo: best };
}

export function clipColor(clip: Clip): string {
  switch (clip.kind) {
    case 'audio':
      return 'var(--color-track-audio)';
    case 'text':
      return 'var(--color-track-text)';
    case 'image':
      return 'var(--color-track-overlay)';
    default:
      return 'var(--color-track-video)';
  }
}
