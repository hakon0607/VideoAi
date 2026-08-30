import type { Clip, EffectType } from '@/types/editor';
import { animatedEffectParam } from '@/lib/editor/keyframes';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Effects that cannot be expressed as a canvas filter string. They run on the
 * clip's own scratch canvas after it has been drawn, so one clip's grain never
 * lands on the clip underneath it.
 */
export type PostEffect =
  | { kind: 'vignette'; amount: number; softness: number }
  | { kind: 'sharpen'; amount: number }
  | { kind: 'pixelate'; size: number }
  | { kind: 'grain'; amount: number; size: number }
  | { kind: 'aberration'; amount: number }
  | { kind: 'glow'; amount: number; radius: number }
  | { kind: 'mirror'; axis: number }
  | { kind: 'colorWash'; color: string; alpha: number };

export interface ResolvedEffects {
  /** Value for ctx.filter while drawing the source, or 'none'. */
  filter: string;
  post: PostEffect[];
  /** Camera shake, as a fraction of the frame. Added to the clip transform. */
  shake: { x: number; y: number; rotation: number };
}

/** Deterministic pseudo-noise, so a rendered frame always looks the same. */
function wobble(time: number, speed: number, seed: number): number {
  return (
    Math.sin(time * speed + seed) * 0.6 +
    Math.sin(time * speed * 2.37 + seed * 3.1) * 0.3 +
    Math.sin(time * speed * 5.11 + seed * 7.7) * 0.1
  );
}

/**
 * Turns a clip's effect stack into something the compositor can execute.
 * Colour and blur map onto the canvas filter property, which is hardware
 * accelerated; everything else becomes a post-processing pass.
 */
export function resolveEffects(clip: Clip, localTime: number): ResolvedEffects {
  const parts: string[] = [];
  const post: PostEffect[] = [];
  const shake = { x: 0, y: 0, rotation: 0 };

  for (const effect of clip.effects) {
    if (!effect.enabled) continue;
    const p = (name: string, fallback: number) =>
      animatedEffectParam(clip, effect.id, name, localTime, effect.params[name] ?? fallback);

    switch (effect.type as EffectType) {
      /* --- canvas filters ------------------------------------------------ */
      case 'blur':
        parts.push(`blur(${p('radius', 0).toFixed(2)}px)`);
        break;
      case 'brightness':
        parts.push(`brightness(${p('amount', 1).toFixed(3)})`);
        break;
      case 'contrast':
        parts.push(`contrast(${p('amount', 1).toFixed(3)})`);
        break;
      case 'saturation':
        parts.push(`saturate(${p('amount', 1).toFixed(3)})`);
        break;
      case 'exposure':
        // Stops are how photographers think about it; brightness is what the
        // canvas understands.
        parts.push(`brightness(${Math.pow(2, p('stops', 0)).toFixed(3)})`);
        break;
      case 'grayscale':
        parts.push(`grayscale(${p('amount', 1).toFixed(3)})`);
        break;
      case 'sepia':
        parts.push(`sepia(${p('amount', 1).toFixed(3)})`);
        break;
      case 'invert':
        parts.push(`invert(${p('amount', 1).toFixed(3)})`);
        break;
      case 'hue_rotate':
        parts.push(`hue-rotate(${p('degrees', 0).toFixed(1)}deg)`);
        break;

      /* --- colour washes -------------------------------------------------- */
      case 'temperature': {
        const amount = p('amount', 0);
        if (Math.abs(amount) > 0.001) {
          post.push({
            kind: 'colorWash',
            color: amount > 0 ? 'rgb(255,168,79)' : 'rgb(79,168,255)',
            alpha: Math.min(0.6, Math.abs(amount) * 0.45),
          });
        }
        break;
      }
      case 'tint': {
        const amount = p('amount', 0);
        if (Math.abs(amount) > 0.001) {
          post.push({
            kind: 'colorWash',
            color: amount > 0 ? 'rgb(255,80,220)' : 'rgb(120,255,120)',
            alpha: Math.min(0.6, Math.abs(amount) * 0.4),
          });
        }
        break;
      }

      /* --- post passes ---------------------------------------------------- */
      case 'vignette':
        post.push({ kind: 'vignette', amount: p('amount', 0.4), softness: p('softness', 0.6) });
        break;
      case 'sharpen':
        post.push({ kind: 'sharpen', amount: p('amount', 0) });
        break;
      case 'pixelate':
        post.push({ kind: 'pixelate', size: p('size', 10) });
        break;
      case 'film_grain':
        post.push({ kind: 'grain', amount: p('amount', 0.25), size: p('size', 1.5) });
        break;
      case 'chromatic_aberration':
        post.push({ kind: 'aberration', amount: p('amount', 0) });
        break;
      case 'glow':
        post.push({ kind: 'glow', amount: p('amount', 0.3), radius: p('radius', 12) });
        break;
      case 'mirror':
        post.push({ kind: 'mirror', axis: p('axis', 0) });
        break;

      /* --- transform-level ------------------------------------------------ */
      case 'shake': {
        const amount = p('amount', 0);
        const speed = p('speed', 9);
        shake.x += wobble(localTime, speed, 1.7) * amount;
        shake.y += wobble(localTime, speed, 4.2) * amount;
        shake.rotation += wobble(localTime, speed * 0.7, 9.1) * amount * 40;
        break;
      }
    }
  }

  return { filter: parts.length ? parts.join(' ') : 'none', post, shake };
}

/* -------------------------------------------------------------------------- */
/* Post-processing passes                                                     */
/* -------------------------------------------------------------------------- */

let grainTile: HTMLCanvasElement | OffscreenCanvas | null = null;

/** One noise tile, generated once and reused. Regenerating it per frame is the
 *  difference between grain that costs nothing and grain that halves the frame
 *  rate. */
function getGrainTile(): HTMLCanvasElement | OffscreenCanvas | null {
  if (grainTile) return grainTile;
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  const size = 256;
  const canvas =
    typeof document !== 'undefined'
      ? Object.assign(document.createElement('canvas'), { width: size, height: size })
      : new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) return null;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 128 + (Math.random() - 0.5) * 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  grainTile = canvas;
  return grainTile;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    return Object.assign(document.createElement('canvas'), { width, height });
  }
  return new OffscreenCanvas(width, height);
}

/** Unsharp mask. Runs on the clip's own canvas, so it is bounded by clip size. */
function applySharpen(ctx: Ctx2D, width: number, height: number, amount: number): void {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (amount <= 0 || w < 3 || h < 3) return;

  const image = ctx.getImageData(0, 0, w, h);
  const src = image.data;
  const out = new Uint8ClampedArray(src);
  const centre = 1 + 4 * amount;
  const side = -amount;

  for (let py = 1; py < h - 1; py += 1) {
    for (let px = 1; px < w - 1; px += 1) {
      const i = (py * w + px) * 4;
      for (let c = 0; c < 3; c += 1) {
        out[i + c] =
          src[i + c] * centre +
          src[i - 4 + c] * side +
          src[i + 4 + c] * side +
          src[i - w * 4 + c] * side +
          src[i + w * 4 + c] * side;
      }
    }
  }
  image.data.set(out);
  ctx.putImageData(image, 0, 0);
}

/**
 * Runs the post passes on a canvas that already holds the drawn clip.
 * `time` seeds the animated ones so grain crawls instead of freezing.
 */
export function applyPostEffects(
  ctx: Ctx2D,
  effects: PostEffect[],
  width: number,
  height: number,
  time: number,
): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'colorWash': {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = effect.alpha;
        ctx.fillStyle = effect.color;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
        break;
      }

      case 'vignette': {
        const gradient = ctx.createRadialGradient(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.25 * effect.softness,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.75,
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${Math.min(1, Math.max(0, effect.amount))})`);
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
        break;
      }

      case 'pixelate': {
        const size = Math.max(2, effect.size);
        const w = Math.max(1, Math.floor(width / size));
        const h = Math.max(1, Math.floor(height / size));
        const small = makeCanvas(w, h);
        const smallCtx = small.getContext('2d') as Ctx2D | null;
        if (!smallCtx) break;
        smallCtx.drawImage(ctx.canvas as CanvasImageSource, 0, 0, w, h);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(small as CanvasImageSource, 0, 0, width, height);
        ctx.restore();
        break;
      }

      case 'grain': {
        const tile = getGrainTile();
        if (!tile) break;
        const scale = Math.max(0.5, effect.size);
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = Math.min(1, effect.amount) * 0.5;
        // Shift the tile every frame so the grain moves like real film.
        const offsetX = ((time * 91) % 256) * scale;
        const offsetY = ((time * 57) % 256) * scale;
        for (let y = -offsetY; y < height; y += 256 * scale) {
          for (let x = -offsetX; x < width; x += 256 * scale) {
            ctx.drawImage(tile as CanvasImageSource, x, y, 256 * scale, 256 * scale);
          }
        }
        ctx.restore();
        break;
      }

      case 'aberration': {
        const shift = effect.amount;
        if (shift <= 0) break;
        const copy = makeCanvas(width, height);
        const copyCtx = copy.getContext('2d') as Ctx2D | null;
        if (!copyCtx) break;
        copyCtx.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.5;
        ctx.filter = 'url(#none)';
        ctx.filter = 'none';
        // Red pulled one way, blue the other: the classic lens fringe.
        ctx.drawImage(copy as CanvasImageSource, -shift, 0);
        ctx.drawImage(copy as CanvasImageSource, shift, 0);
        ctx.restore();
        break;
      }

      case 'glow': {
        const copy = makeCanvas(width, height);
        const copyCtx = copy.getContext('2d') as Ctx2D | null;
        if (!copyCtx) break;
        copyCtx.filter = `blur(${effect.radius}px) brightness(1.4)`;
        copyCtx.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, effect.amount);
        ctx.drawImage(copy as CanvasImageSource, 0, 0);
        ctx.restore();
        break;
      }

      case 'mirror': {
        const copy = makeCanvas(width, height);
        const copyCtx = copy.getContext('2d') as Ctx2D | null;
        if (!copyCtx) break;
        copyCtx.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
        ctx.save();
        if (effect.axis < 0.5) {
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(copy as CanvasImageSource, 0, 0, width / 2, height, 0, 0, width / 2, height);
        } else {
          ctx.translate(0, height);
          ctx.scale(1, -1);
          ctx.drawImage(copy as CanvasImageSource, 0, 0, width, height / 2, 0, 0, width, height / 2);
        }
        ctx.restore();
        break;
      }

      case 'sharpen':
        applySharpen(ctx, width, height, effect.amount);
        break;
    }
  }
}

export function hasPostEffects(effects: ResolvedEffects): boolean {
  return effects.post.length > 0;
}
