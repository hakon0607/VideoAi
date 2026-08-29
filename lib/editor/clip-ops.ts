import type { Clip, Keyframe, MediaClip } from '@/types/editor';
import { isMediaClip } from '@/types/editor';
import { EditorError } from './errors';
import { clipEnd, q } from './time';

const MIN_CLIP_DURATION = 0.02;

/** Keyframe times are clip-relative, so they shift when the head is trimmed. */
function shiftKeyframes(keyframes: Keyframe[], delta: number, newDuration: number): Keyframe[] {
  return keyframes
    .map((kf) => ({ ...kf, time: q(kf.time - delta) }))
    .filter((kf) => kf.time >= -0.0001 && kf.time <= newDuration + 0.0001)
    .map((kf) => ({ ...kf, time: Math.max(0, Math.min(newDuration, kf.time)) }));
}

/**
 * Moves the head of a clip to `newStart` on the timeline, consuming source
 * material so the picture does not shift.
 */
export function trimClipStart(clip: Clip, newStart: number): Clip {
  const end = clipEnd(clip);
  const start = q(Math.max(0, newStart));
  if (end - start < MIN_CLIP_DURATION) {
    throw new EditorError('invalid_range', `Trimming clip "${clip.name}" that far would leave nothing behind.`, {
      clipId: clip.id,
      requestedStart: newStart,
      clipEnd: end,
    });
  }
  const delta = start - clip.start;
  const duration = q(end - start);
  const base = { ...clip, start, duration, keyframes: shiftKeyframes(clip.keyframes, delta, duration) };
  if (isMediaClip(clip) && !clip.freeze) {
    const media = base as MediaClip;
    // Reversed clips consume material from the tail, so the in-point is unchanged.
    return clip.reversed ? media : { ...media, sourceIn: q(clip.sourceIn + delta * clip.speed) };
  }
  return base;
}

/** Moves the tail of a clip to `newEnd` on the timeline. */
export function trimClipEnd(clip: Clip, newEnd: number): Clip {
  const end = q(newEnd);
  if (end - clip.start < MIN_CLIP_DURATION) {
    throw new EditorError('invalid_range', `Trimming clip "${clip.name}" that far would leave nothing behind.`, {
      clipId: clip.id,
      requestedEnd: newEnd,
      clipStart: clip.start,
    });
  }
  const duration = q(end - clip.start);
  const base = { ...clip, duration, keyframes: shiftKeyframes(clip.keyframes, 0, duration) };
  if (isMediaClip(clip) && clip.reversed && !clip.freeze) {
    // Trimming the tail of a reversed clip consumes material from the head.
    const consumed = q((clip.duration - duration) * clip.speed);
    return { ...(base as MediaClip), sourceIn: q(clip.sourceIn + consumed) };
  }
  return base;
}

/**
 * Splits a clip at a timeline timestamp. Returns the two halves; the second one
 * gets `newId`. Transitions stay attached to the outer edges.
 */
export function splitClipAt(clip: Clip, time: number, newId: string): [Clip, Clip] {
  const t = q(time);
  if (t <= clip.start + MIN_CLIP_DURATION || t >= clipEnd(clip) - MIN_CLIP_DURATION) {
    throw new EditorError('invalid_time', `${t.toFixed(3)} s is not inside clip "${clip.name}".`, {
      clipId: clip.id,
      clipStart: clip.start,
      clipEnd: clipEnd(clip),
      requestedTime: t,
    });
  }
  const left = { ...trimClipEnd(clip, t), transitionOut: null };
  const right = { ...trimClipStart(clip, t), id: newId, transitionIn: null };
  // Fades belong to the outer edges of the pair.
  if (isMediaClip(left) && isMediaClip(right)) {
    (left as MediaClip).fadeOut = 0;
    (right as MediaClip).fadeIn = 0;
  }
  return [left, right];
}

/**
 * Cuts the timeline range [start, end) out of a single clip.
 * Returns the surviving pieces, in timeline order (0, 1 or 2 clips).
 */
export function subtractRange(clip: Clip, start: number, end: number, newId: () => string): Clip[] {
  const cStart = clip.start;
  const cEnd = clipEnd(clip);
  if (end <= cStart || start >= cEnd) return [clip];
  const coversHead = start <= cStart;
  const coversTail = end >= cEnd;
  if (coversHead && coversTail) return [];
  if (coversHead) return [trimClipStart(clip, end)];
  if (coversTail) return [trimClipEnd(clip, start)];
  // The range sits strictly inside the clip: split, then drop the middle.
  const left = trimClipEnd(clip, start);
  const right = { ...trimClipStart(clip, end), id: newId(), transitionIn: null };
  (left as Clip).transitionOut = null;
  return [left, right];
}

/** Shifts a clip along the timeline, clamping at zero. */
export function shiftClip(clip: Clip, delta: number): Clip {
  return { ...clip, start: q(Math.max(0, clip.start + delta)) };
}

export { MIN_CLIP_DURATION };
