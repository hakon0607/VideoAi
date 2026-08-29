import type { Clip, Easing, Keyframe } from '@/types/editor';

function ease(t: number, easing: Easing): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'ease_in':
      return t * t;
    case 'ease_out':
      return 1 - (1 - t) * (1 - t);
    case 'hold':
      return 0;
    default:
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}

/**
 * Value of a keyframed property at `localTime` (seconds from the clip's start).
 * With no keyframes the static value is returned unchanged.
 */
export function evaluateKeyframes(
  keyframes: Keyframe[],
  property: string,
  localTime: number,
  fallback: number,
): number {
  const track = keyframes.filter((kf) => kf.property === property).sort((a, b) => a.time - b.time);
  if (track.length === 0) return fallback;
  if (track.length === 1) return track[0].value;
  if (localTime <= track[0].time) return track[0].value;
  const last = track[track.length - 1];
  if (localTime >= last.time) return last.value;

  for (let i = 0; i < track.length - 1; i += 1) {
    const a = track[i];
    const b = track[i + 1];
    if (localTime >= a.time && localTime <= b.time) {
      const span = b.time - a.time;
      const t = span <= 0 ? 1 : (localTime - a.time) / span;
      return a.value + (b.value - a.value) * ease(t, a.easing);
    }
  }
  return fallback;
}

export interface AnimatedValues {
  opacity: number;
  scale: number;
  x: number;
  y: number;
  rotation: number;
  volume: number;
}

/** Resolves every animatable property of a clip at a given local time. */
export function animatedValues(clip: Clip, localTime: number): AnimatedValues {
  const t = clip.transform;
  const staticVolume = 'volume' in clip ? (clip.volume as number) : 1;
  return {
    opacity: evaluateKeyframes(clip.keyframes, 'opacity', localTime, clip.opacity),
    scale: evaluateKeyframes(clip.keyframes, 'scale', localTime, t.scale),
    x: evaluateKeyframes(clip.keyframes, 'x', localTime, t.x),
    y: evaluateKeyframes(clip.keyframes, 'y', localTime, t.y),
    rotation: evaluateKeyframes(clip.keyframes, 'rotation', localTime, t.rotation),
    volume: evaluateKeyframes(clip.keyframes, 'volume', localTime, staticVolume),
  };
}

/** Effect parameter value with any `effect:<id>:<param>` keyframes applied. */
export function animatedEffectParam(
  clip: Clip,
  effectId: string,
  param: string,
  localTime: number,
  fallback: number,
): number {
  return evaluateKeyframes(clip.keyframes, `effect:${effectId}:${param}`, localTime, fallback);
}

export function hasKeyframes(clip: Clip, property?: string): boolean {
  return property ? clip.keyframes.some((kf) => kf.property === property) : clip.keyframes.length > 0;
}
