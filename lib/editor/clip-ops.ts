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

/**
 * Cleans up after a ripple.
 *
 * Sliding clips backwards can push them into a locked clip, which no longer
 * moves out of the way — the result would be one clip hidden behind another.
 * This walks each track in order and nudges movable clips forward just enough
 * to sit clear of the immovable ones and of each other.
 */
export function settleAfterRipple(clips: Clip[], isImmovable: (clip: Clip) => boolean): Clip[] {
  const byTrack = new Map<string, Clip[]>();
  for (const clip of clips) {
    const list = byTrack.get(clip.trackId);
    if (list) list.push(clip);
    else byTrack.set(clip.trackId, [clip]);
  }

  const moved = new Map<string, number>();
  for (const list of byTrack.values()) {
    const blockers = list.filter(isImmovable).sort((a, b) => a.start - b.start);
    if (blockers.length === 0) continue;

    const movable = list.filter((c) => !isImmovable(c)).sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const clip of movable) {
      let start = Math.max(clip.start, cursor);
      // Step over every blocker this clip would land on top of.
      for (let guard = 0; guard < blockers.length + 1; guard += 1) {
        const hit = blockers.find((b) => start < clipEnd(b) - 0.001 && start + clip.duration > b.start + 0.001);
        if (!hit) break;
        start = clipEnd(hit);
      }
      if (start !== clip.start) moved.set(clip.id, q(start));
      cursor = start + clip.duration;
    }
  }

  if (moved.size === 0) return clips;
  return clips.map((clip) => (moved.has(clip.id) ? { ...clip, start: moved.get(clip.id) as number } : clip));
}

/** Shifts a clip along the timeline, clamping at zero. */
export function shiftClip(clip: Clip, delta: number): Clip {
  return { ...clip, start: q(Math.max(0, clip.start + delta)) };
}

export { MIN_CLIP_DURATION };
