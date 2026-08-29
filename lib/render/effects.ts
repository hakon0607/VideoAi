import type { Clip, Effect } from '@/types/editor';
import { animatedEffectParam } from '@/lib/editor/keyframes';

export interface ResolvedEffects {
  /** Value for ctx.filter, or 'none'. */
  filter: string;
  vignette: { amount: number; softness: number } | null;
  sharpen: number;
}

/**
 * Turns a clip's effect stack into something a 2D context can apply.
 * Most effects map onto the canvas filter property, which is hardware
 * accelerated; vignette and sharpen are drawn manually afterwards.
 */
export function resolveEffects(clip: Clip, localTime: number): ResolvedEffects {
  const parts: string[] = [];
  let vignette: ResolvedEffects['vignette'] = null;
  let sharpen = 0;

  for (const effect of clip.effects) {
    if (!effect.enabled) continue;
    const p = (name: string, fallback: number) => animatedEffectParam(clip, effect.id, name, localTime, fallback);
    switch (effect.type) {
      case 'blur':
        parts.push(`blur(${p('radius', effect.params.radius ?? 0).toFixed(2)}px)`);
        break;
      case 'brightness':
        parts.push(`brightness(${p('amount', effect.params.amount ?? 1).toFixed(3)})`);
        break;
      case 'contrast':
        parts.push(`contrast(${p('amount', effect.params.amount ?? 1).toFixed(3)})`);
        break;
      case 'saturation':
        parts.push(`saturate(${p('amount', effect.params.amount ?? 1).toFixed(3)})`);
        break;
      case 'grayscale':
        parts.push(`grayscale(${p('amount', effect.params.amount ?? 1).toFixed(3)})`);
        break;
      case 'sepia':
        parts.push(`sepia(${p('amount', effect.params.amount ?? 1).toFixed(3)})`);
        break;
      case 'invert':
        parts.push(`invert(${p('amount', effect.params.amount ?? 1).toFixed(3)})`);
        break;
      case 'hue_rotate':
        parts.push(`hue-rotate(${p('degrees', effect.params.degrees ?? 0).toFixed(1)}deg)`);
        break;
      case 'vignette':
        vignette = {
          amount: p('amount', effect.params.amount ?? 0.4),
          softness: p('softness', effect.params.softness ?? 0.6),
        };
        break;
      case 'sharpen':
        sharpen = p('amount', effect.params.amount ?? 0);
        break;
    }
  }

  return { filter: parts.length ? parts.join(' ') : 'none', vignette, sharpen };
}

export function effectLabel(effect: Effect): string {
  return effect.type.replace('_', ' ');
}

/** Unsharp mask. Runs on the composited region, so it is applied last. */
export function applySharpen(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  amount: number,
): void {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (amount <= 0 || w < 3 || h < 3) return;

  const image = ctx.getImageData(Math.round(x), Math.round(y), w, h);
  const src = image.data;
  const out = new Uint8ClampedArray(src);
  const centre = 1 + 4 * amount;
  const side = -amount;

  for (let py = 1; py < h - 1; py += 1) {
    for (let px = 1; px < w - 1; px += 1) {
      const i = (py * w + px) * 4;
      for (let c = 0; c < 3; c += 1) {
        const value =
          src[i + c] * centre +
          src[i - 4 + c] * side +
          src[i + 4 + c] * side +
          src[i - w * 4 + c] * side +
          src[i + w * 4 + c] * side;
        out[i + c] = value;
      }
    }
  }
  image.data.set(out);
  ctx.putImageData(image, Math.round(x), Math.round(y));
}
