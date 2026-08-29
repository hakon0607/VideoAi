import type { Clip, EditorState, MediaClip, TextClip, Transition } from '@/types/editor';
import { isTextClip } from '@/types/editor';
import { animatedValues } from '@/lib/editor/keyframes';
import { clipEnd } from '@/lib/editor/time';
import { getTrack } from '@/lib/editor/selectors';
import { applySharpen, resolveEffects } from './effects';

export type Drawable = CanvasImageSource & { width?: number; height?: number };

/**
 * Supplies decoded frames to the compositor. The preview implements this with
 * <video> elements; the exporter implements it with decoded frames from
 * mediabunny. Both then go through the exact same drawing code, so what you
 * see in the preview is what lands in the file.
 */
export interface FrameProvider {
  getFrame(clip: MediaClip, sourceTime: number): Drawable | null;
  /** Intrinsic pixel size of the clip's source, used for fitting. */
  getSize(clip: MediaClip): { width: number; height: number } | null;
}

export interface ComposeOptions {
  /** Renders selection affordances. Off during export. */
  highlightClipId?: string | null;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * `fade` happens inside the clip (fade from/to the background). The blending
 * transitions instead straddle the cut, so the clip has to keep rendering for
 * half the transition beyond its own edge — that overlap is what makes a
 * crossfade an actual dissolve rather than a dip to black.
 */
export function isOverlapTransition(type: Transition['type']): boolean {
  return type === 'crossfade' || type === 'dissolve' || type === 'slide' || type === 'zoom' || type === 'wipe';
}

function overhang(transition: Transition | null): number {
  return transition && isOverlapTransition(transition.type) ? transition.duration / 2 : 0;
}

/** Window in which a clip contributes to the picture, including its transitions. */
export function clipRenderWindow(clip: Clip): { start: number; end: number } {
  return {
    start: clip.start - overhang(clip.transitionIn),
    end: clipEnd(clip) + overhang(clip.transitionOut),
  };
}

export function visibleClips(state: EditorState, time: number): Clip[] {
  const trackIndex = new Map(state.tracks.map((t) => [t.id, t.index]));
  return state.clips
    .filter((clip) => {
      if (clip.kind === 'audio') return false;
      const track = getTrack(state, clip.trackId);
      if (!track || track.hidden) return false;
      const w = clipRenderWindow(clip);
      return time >= w.start && time < w.end;
    })
    .sort(
      (a, b) =>
        (trackIndex.get(a.trackId) ?? 0) - (trackIndex.get(b.trackId) ?? 0) || a.start - b.start,
    );
}

interface TransitionEffect {
  alpha: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  clip: { x: number; y: number; w: number; h: number } | null;
}

const NEUTRAL: TransitionEffect = { alpha: 1, offsetX: 0, offsetY: 0, scale: 1, clip: null };

function direction(transition: Transition): 'left' | 'right' | 'up' | 'down' {
  const value = transition.params.direction;
  return value === 'right' || value === 'up' || value === 'down' ? value : 'left';
}

function applyTransition(
  transition: Transition,
  progress: number,
  entering: boolean,
  width: number,
  height: number,
): TransitionEffect {
  // `progress` runs 0 -> 1 across the transition window.
  const p = Math.min(1, Math.max(0, progress));
  const amount = entering ? p : 1 - p;

  switch (transition.type) {
    case 'fade':
    case 'crossfade':
    case 'dissolve':
      return { ...NEUTRAL, alpha: amount };
    case 'zoom':
      return { ...NEUTRAL, alpha: amount, scale: entering ? 0.8 + 0.2 * p : 1 + 0.2 * p };
    case 'slide': {
      const dir = direction(transition);
      const travel = entering ? 1 - p : -p;
      const dx = dir === 'left' ? travel * width : dir === 'right' ? -travel * width : 0;
      const dy = dir === 'up' ? travel * height : dir === 'down' ? -travel * height : 0;
      return { ...NEUTRAL, offsetX: dx, offsetY: dy };
    }
    case 'wipe': {
      const dir = direction(transition);
      const reveal = entering ? p : 1 - p;
      if (dir === 'left') return { ...NEUTRAL, clip: { x: 0, y: 0, w: width * reveal, h: height } };
      if (dir === 'right') return { ...NEUTRAL, clip: { x: width * (1 - reveal), y: 0, w: width * reveal, h: height } };
      if (dir === 'up') return { ...NEUTRAL, clip: { x: 0, y: 0, w: width, h: height * reveal } };
      return { ...NEUTRAL, clip: { x: 0, y: height * (1 - reveal), w: width, h: height * reveal } };
    }
    default:
      return NEUTRAL;
  }
}

function transitionAt(clip: Clip, time: number, width: number, height: number): TransitionEffect {
  const inT = clip.transitionIn;
  if (inT) {
    // Overlap transitions are centred on the cut; a fade lives inside the clip.
    const from = clip.start - overhang(inT);
    const to = from + inT.duration;
    if (time < to) return applyTransition(inT, (time - from) / inT.duration, true, width, height);
  }
  const outT = clip.transitionOut;
  if (outT) {
    const to = clipEnd(clip) + overhang(outT);
    const from = to - outT.duration;
    if (time > from) return applyTransition(outT, (time - from) / outT.duration, false, width, height);
  }
  return NEUTRAL;
}

/** Wraps text to a maximum width, honouring explicit newlines. */
export function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

function textAnimation(clip: TextClip, local: number): { alpha: number; scale: number; dy: number; chars: number } {
  const duration = 0.35;
  const p = Math.min(1, Math.max(0, local / duration));
  switch (clip.animation) {
    case 'fade':
      return { alpha: p, scale: 1, dy: 0, chars: clip.text.length };
    case 'pop': {
      const overshoot = 1 + 0.18 * Math.sin(Math.PI * p);
      return { alpha: p, scale: p < 1 ? 0.86 + 0.14 * p * overshoot : 1, dy: 0, chars: clip.text.length };
    }
    case 'slide_up':
      return { alpha: p, scale: 1, dy: (1 - p) * 0.06, chars: clip.text.length };
    case 'typewriter': {
      const speed = Math.max(0.4, clip.duration * 0.6);
      return { alpha: 1, scale: 1, dy: 0, chars: Math.ceil((local / speed) * clip.text.length) };
    }
    default:
      return { alpha: 1, scale: 1, dy: 0, chars: clip.text.length };
  }
}

function drawTextClip(ctx: Ctx2D, clip: TextClip, local: number, width: number, height: number): void {
  const style = clip.style;
  const anim = textAnimation(clip, local);
  const values = animatedValues(clip, local);

  const fontSize = style.fontSize * height * anim.scale * values.scale;
  const font = `${style.italic ? 'italic ' : ''}${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = style.align;

  const content = style.uppercase ? clip.text.toUpperCase() : clip.text;
  const shown = anim.chars >= content.length ? content : content.slice(0, Math.max(0, anim.chars));
  if (!shown) return;

  const maxWidth = style.maxWidth * width;
  const lines = wrapText(ctx, shown, maxWidth);
  const lineHeight = fontSize * style.lineHeight;
  const blockHeight = lines.length * lineHeight;

  const centreX = width / 2 + values.x * width;
  const centreY = height / 2 + (values.y + anim.dy) * height;
  const anchorX = style.align === 'left' ? centreX - maxWidth / 2 : style.align === 'right' ? centreX + maxWidth / 2 : centreX;

  ctx.save();
  ctx.globalAlpha *= anim.alpha * values.opacity;
  if (values.rotation) {
    ctx.translate(centreX, centreY);
    ctx.rotate((values.rotation * Math.PI) / 180);
    ctx.translate(-centreX, -centreY);
  }

  // Background box
  if (style.backgroundColor && !style.backgroundColor.endsWith(',0)') && style.backgroundColor !== 'transparent') {
    let widest = 0;
    for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
    const padX = style.backgroundPadding * width;
    const padY = style.backgroundPadding * height * 0.6;
    const boxW = widest + padX * 2;
    const boxH = blockHeight + padY * 2;
    const boxX =
      style.align === 'left' ? anchorX - padX : style.align === 'right' ? anchorX - boxW + padX : centreX - boxW / 2;
    const boxY = centreY - boxH / 2;
    ctx.fillStyle = style.backgroundColor;
    const r = Math.min(style.backgroundRadius * width, boxH / 2);
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, r);
    ctx.fill();
  }

  if (style.shadowBlur > 0) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur * height;
    ctx.shadowOffsetY = style.shadowOffsetY * height;
  }

  const startY = centreY - blockHeight / 2 + lineHeight / 2;
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    if (style.strokeWidth > 0) {
      ctx.lineWidth = style.strokeWidth * height * 2;
      ctx.strokeStyle = style.strokeColor;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, anchorX, y);
  });

  ctx.restore();
}

function drawVignette(ctx: Ctx2D, width: number, height: number, amount: number, softness: number): void {
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.25 * softness,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(1, Math.max(0, amount))})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawMediaClip(
  ctx: Ctx2D,
  clip: MediaClip,
  time: number,
  provider: FrameProvider,
  width: number,
  height: number,
): void {
  // `local` can fall slightly outside [0, duration) during an overlapping
  // transition. That is deliberate: reading the source beyond the cut is what
  // makes a crossfade a real dissolve instead of a freeze frame.
  const local = time - clip.start;
  const sourceTime = clip.freeze
    ? clip.sourceIn
    : clip.reversed
      ? clip.sourceIn + clip.duration * clip.speed - local * clip.speed
      : clip.sourceIn + local * clip.speed;

  const frame = provider.getFrame(clip, Math.max(0, sourceTime));
  if (!frame) return;

  const size = provider.getSize(clip) ?? { width: 1920, height: 1080 };
  const values = animatedValues(clip, local);
  const effects = resolveEffects(clip, local);
  const transition = transitionAt(clip, time, width, height);

  const crop = clip.crop;
  const sx = crop ? size.width * crop.left : 0;
  const sy = crop ? size.height * crop.top : 0;
  const sw = crop ? size.width * (1 - crop.left - crop.right) : size.width;
  const sh = crop ? size.height * (1 - crop.top - crop.bottom) : size.height;
  if (sw <= 0 || sh <= 0) return;

  // Contain-fit the source in the frame, then apply the clip transform.
  const fit = Math.min(width / sw, height / sh);
  const scale = fit * values.scale * transition.scale;
  const drawW = sw * scale;
  const drawH = sh * scale;
  const cx = width / 2 + values.x * width + transition.offsetX;
  const cy = height / 2 + values.y * height + transition.offsetY;

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, values.opacity * transition.alpha));
  if (transition.clip) {
    ctx.beginPath();
    ctx.rect(transition.clip.x, transition.clip.y, transition.clip.w, transition.clip.h);
    ctx.clip();
  }
  ctx.filter = effects.filter;
  ctx.translate(cx, cy);
  if (values.rotation) ctx.rotate((values.rotation * Math.PI) / 180);
  ctx.scale(clip.transform.flipH ? -1 : 1, clip.transform.flipV ? -1 : 1);
  try {
    ctx.drawImage(frame, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
  } catch {
    // A frame that is not decoded yet throws; skipping it is correct.
  }
  ctx.restore();

  if (effects.vignette) drawVignette(ctx, width, height, effects.vignette.amount, effects.vignette.softness);
  if (effects.sharpen > 0) {
    applySharpen(
      ctx,
      Math.max(0, cx - drawW / 2),
      Math.max(0, cy - drawH / 2),
      Math.min(width, drawW),
      Math.min(height, drawH),
      effects.sharpen,
    );
  }
}

/**
 * Draws the whole composition for one timestamp. This is the single source of
 * truth for what a frame looks like, shared by the preview and the exporter.
 */
export function composeFrame(
  ctx: Ctx2D,
  state: EditorState,
  time: number,
  provider: FrameProvider,
  options: ComposeOptions = {},
): void {
  const { width, height } = state.settings;
  ctx.save();
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = state.settings.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  for (const clip of visibleClips(state, time)) {
    ctx.save();
    if (isTextClip(clip)) {
      const transition = transitionAt(clip, time, width, height);
      ctx.globalAlpha = transition.alpha;
      ctx.translate(transition.offsetX, transition.offsetY);
      drawTextClip(ctx, clip, time - clip.start, width, height);
    } else {
      drawMediaClip(ctx, clip as MediaClip, time, provider, width, height);
    }
    ctx.restore();
  }

  if (options.highlightClipId) {
    // Nothing is drawn for the highlight in the composited image itself; the
    // preview overlays selection UI in the DOM so it never lands in an export.
  }
}
