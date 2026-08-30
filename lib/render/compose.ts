import type { Clip, EditorState, MediaClip, TextClip, Transition } from '@/types/editor';
import { isTextClip } from '@/types/editor';
import { animatedValues } from '@/lib/editor/keyframes';
import { clipEnd } from '@/lib/editor/time';
import { getTrack } from '@/lib/editor/selectors';
import { applyPostEffects, resolveEffects } from './effects';

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
  /** Skips the per-clip scratch canvas. Faster, but post effects are lost. */
  fastPreview?: boolean;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/* -------------------------------------------------------------------------- */
/* Scratch canvas                                                             */
/* -------------------------------------------------------------------------- */

let scratch: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D } | null = null;

/**
 * One reusable off-screen canvas.
 *
 * Post effects have to run on the clip alone — grain on the title card must not
 * land on the footage underneath — so each clip is drawn here first and then
 * composited. One allocation, reused for the life of the page.
 */
function getScratch(width: number, height: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D } | null {
  if (scratch && scratch.canvas.width === width && scratch.canvas.height === height) {
    scratch.ctx.setTransform(1, 0, 0, 1, 0, 0);
    scratch.ctx.clearRect(0, 0, width, height);
    scratch.ctx.globalAlpha = 1;
    scratch.ctx.globalCompositeOperation = 'source-over';
    scratch.ctx.filter = 'none';
    return scratch;
  }
  const canvas =
    typeof document !== 'undefined'
      ? Object.assign(document.createElement('canvas'), { width, height })
      : typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : null;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) return null;
  scratch = { canvas, ctx };
  return scratch;
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `fade` and `flash` happen inside the clip. The blending transitions straddle
 * the cut, so the clip has to keep rendering for half the transition beyond its
 * own edge — that overlap is what makes a crossfade a dissolve rather than a
 * dip to black.
 */
export function isOverlapTransition(type: Transition['type']): boolean {
  return (
    type === 'crossfade' ||
    type === 'dissolve' ||
    type === 'slide' ||
    type === 'zoom' ||
    type === 'wipe' ||
    type === 'whip_pan' ||
    type === 'glitch' ||
    type === 'blur_dissolve' ||
    type === 'spin'
  );
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
      (a, b) => (trackIndex.get(a.trackId) ?? 0) - (trackIndex.get(b.trackId) ?? 0) || a.start - b.start,
    );
}

interface TransitionEffect {
  alpha: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
  blur: number;
  /** Additive white flash, 0..1. */
  flash: number;
  clip: { x: number; y: number; w: number; h: number } | null;
}

const NEUTRAL: TransitionEffect = {
  alpha: 1,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  blur: 0,
  flash: 0,
  clip: null,
};

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
  const p = Math.min(1, Math.max(0, progress));
  const amount = entering ? p : 1 - p;

  switch (transition.type) {
    case 'fade':
    case 'crossfade':
    case 'dissolve':
      return { ...NEUTRAL, alpha: amount };

    case 'blur_dissolve':
      // Softening as it goes hides the seam between two unrelated shots.
      return { ...NEUTRAL, alpha: amount, blur: (1 - amount) * 18 };

    case 'flash':
      // Peaks white at the midpoint, like a camera flash on the cut.
      return { ...NEUTRAL, alpha: amount, flash: Math.sin(p * Math.PI) };

    case 'zoom':
      return { ...NEUTRAL, alpha: amount, scale: entering ? 0.8 + 0.2 * p : 1 + 0.25 * p };

    case 'spin':
      return {
        ...NEUTRAL,
        alpha: amount,
        scale: entering ? 0.7 + 0.3 * p : 1 - 0.3 * p,
        rotation: entering ? -180 * (1 - p) : 180 * p,
      };

    case 'glitch': {
      // Chunky horizontal displacement plus a hard alpha stutter.
      const step = Math.floor(p * 8) / 8;
      const jitter = (Math.sin(step * 97.3) + Math.sin(step * 41.7)) * 0.5;
      return {
        ...NEUTRAL,
        alpha: amount > 0.5 ? 1 : amount * 2,
        offsetX: jitter * width * 0.06 * (1 - Math.abs(0.5 - p) * 2),
      };
    }

    case 'whip_pan': {
      const dir = direction(transition);
      const travel = entering ? 1 - p : -p;
      const dx = dir === 'left' ? travel * width : dir === 'right' ? -travel * width : 0;
      const dy = dir === 'up' ? travel * height : dir === 'down' ? -travel * height : 0;
      // The motion blur is what separates a whip pan from a slide.
      return { ...NEUTRAL, offsetX: dx, offsetY: dy, blur: (1 - Math.abs(0.5 - p) * 2) * 26 };
    }

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

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

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
      if (ctx.measureText(candidate).width <= maxWidth) current = candidate;
      else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

interface TextAnimationState {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
  rotation: number;
  /** How many characters are shown, for typewriter. */
  chars: number;
  /** Index of the word to highlight, for karaoke. -1 for none. */
  karaokeWord: number;
}

function textAnimation(clip: TextClip, local: number): TextAnimationState {
  const base: TextAnimationState = {
    alpha: 1,
    scale: 1,
    dx: 0,
    dy: 0,
    rotation: 0,
    chars: clip.text.length,
    karaokeWord: -1,
  };
  const duration = 0.35;
  const p = Math.min(1, Math.max(0, local / duration));

  switch (clip.animation) {
    case 'fade':
      return { ...base, alpha: p };
    case 'pop': {
      const overshoot = 1 + 0.18 * Math.sin(Math.PI * p);
      return { ...base, alpha: p, scale: p < 1 ? 0.86 + 0.14 * p * overshoot : 1 };
    }
    case 'bounce': {
      // Settles with a couple of decaying hops rather than easing flatly in.
      const t = Math.min(1, local / 0.6);
      const decay = Math.exp(-4 * t);
      return { ...base, alpha: Math.min(1, local / 0.15), dy: -Math.abs(Math.sin(t * Math.PI * 3)) * decay * 0.05 };
    }
    case 'slide_up':
      return { ...base, alpha: p, dy: (1 - p) * 0.06 };
    case 'slide_left':
      return { ...base, alpha: p, dx: (1 - p) * 0.12 };
    case 'zoom_in':
      return { ...base, alpha: p, scale: 0.5 + 0.5 * p };
    case 'shake': {
      const wobbleAmount = Math.max(0, 1 - local / 0.5) * 0.012;
      return {
        ...base,
        alpha: Math.min(1, local / 0.1),
        dx: Math.sin(local * 40) * wobbleAmount,
        rotation: Math.sin(local * 33) * wobbleAmount * 120,
      };
    }
    case 'wipe':
      return { ...base, alpha: 1, chars: Math.ceil(p * clip.text.length) };
    case 'typewriter': {
      const speed = Math.max(0.4, clip.duration * 0.6);
      return { ...base, chars: Math.ceil((local / speed) * clip.text.length) };
    }
    case 'karaoke': {
      const words = clip.text.split(/\s+/).filter(Boolean);
      const perWord = clip.duration / Math.max(1, words.length);
      return { ...base, karaokeWord: Math.min(words.length - 1, Math.floor(local / perWord)) };
    }
    default:
      return base;
  }
}

function drawTextClip(ctx: Ctx2D, clip: TextClip, local: number, width: number, height: number): void {
  const style = clip.style;
  const anim = textAnimation(clip, local);
  const values = animatedValues(clip, local);

  const fontSize = style.fontSize * height * anim.scale * values.scale;
  ctx.font = `${style.italic ? 'italic ' : ''}${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = style.align;

  const content = style.uppercase ? clip.text.toUpperCase() : clip.text;
  const shown = anim.chars >= content.length ? content : content.slice(0, Math.max(0, anim.chars));
  if (!shown) return;

  const maxWidth = style.maxWidth * width;
  const lines = wrapText(ctx, shown, maxWidth);
  const lineHeight = fontSize * style.lineHeight;
  const blockHeight = lines.length * lineHeight;

  const centreX = width / 2 + (values.x + anim.dx) * width;
  const centreY = height / 2 + (values.y + anim.dy) * height;
  const anchorX =
    style.align === 'left' ? centreX - maxWidth / 2 : style.align === 'right' ? centreX + maxWidth / 2 : centreX;

  ctx.save();
  ctx.globalAlpha *= anim.alpha * values.opacity;
  const rotation = values.rotation + anim.rotation;
  if (rotation) {
    ctx.translate(centreX, centreY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-centreX, -centreY);
  }

  if (style.backgroundColor && !style.backgroundColor.endsWith(',0)') && style.backgroundColor !== 'transparent') {
    let widest = 0;
    for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
    const padX = style.backgroundPadding * width;
    const padY = style.backgroundPadding * height * 0.6;
    const boxW = widest + padX * 2;
    const boxH = blockHeight + padY * 2;
    const boxX =
      style.align === 'left' ? anchorX - padX : style.align === 'right' ? anchorX - boxW + padX : centreX - boxW / 2;
    ctx.fillStyle = style.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(boxX, centreY - boxH / 2, boxW, boxH, Math.min(style.backgroundRadius * width, boxH / 2));
    ctx.fill();
  }

  if (style.shadowBlur > 0) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur * height;
    ctx.shadowOffsetY = style.shadowOffsetY * height;
  }

  const startY = centreY - blockHeight / 2 + lineHeight / 2;

  if (anim.karaokeWord >= 0) {
    drawKaraoke(ctx, lines, anim.karaokeWord, style, anchorX, startY, lineHeight);
  } else {
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
  }

  ctx.restore();
}

/**
 * Word-by-word highlight, the way short-form captions read. The whole line
 * stays visible; only the word being spoken changes colour.
 */
function drawKaraoke(
  ctx: Ctx2D,
  lines: string[],
  activeWord: number,
  style: TextClip['style'],
  anchorX: number,
  startY: number,
  lineHeight: number,
): void {
  const highlight = typeof style.backgroundColor === 'string' && style.backgroundColor.startsWith('#')
    ? style.backgroundColor
    : '#ffd166';
  let wordIndex = 0;
  const previousAlign = ctx.textAlign;
  ctx.textAlign = 'left';

  lines.forEach((line, lineNumber) => {
    const words = line.split(' ');
    const lineWidth = ctx.measureText(line).width;
    const y = startY + lineNumber * lineHeight;
    let x =
      previousAlign === 'left' ? anchorX : previousAlign === 'right' ? anchorX - lineWidth : anchorX - lineWidth / 2;

    for (const word of words) {
      const isActive = wordIndex === activeWord;
      const text = `${word} `;
      if (style.strokeWidth > 0) {
        ctx.lineWidth = style.strokeWidth * lineHeight * 2;
        ctx.strokeStyle = style.strokeColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, x, y);
      }
      ctx.fillStyle = isActive ? highlight : style.color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
      wordIndex += 1;
    }
  });

  ctx.textAlign = previousAlign;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */

function drawMediaClip(
  target: Ctx2D,
  clip: MediaClip,
  time: number,
  provider: FrameProvider,
  width: number,
  height: number,
  fastPreview: boolean,
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
  const cx = width / 2 + (values.x + effects.shake.x) * width + transition.offsetX;
  const cy = height / 2 + (values.y + effects.shake.y) * height + transition.offsetY;
  const rotation = values.rotation + effects.shake.rotation + transition.rotation;

  const needsScratch = !fastPreview && effects.post.length > 0;
  const board = needsScratch ? getScratch(width, height) : null;
  const ctx: Ctx2D = board ? board.ctx : target;

  ctx.save();
  if (!board) {
    ctx.globalAlpha = Math.min(1, Math.max(0, values.opacity * transition.alpha));
    if (transition.clip) {
      ctx.beginPath();
      ctx.rect(transition.clip.x, transition.clip.y, transition.clip.w, transition.clip.h);
      ctx.clip();
    }
  }
  const blurFilter = transition.blur > 0 ? `blur(${transition.blur.toFixed(1)}px)` : '';
  ctx.filter = [effects.filter === 'none' ? '' : effects.filter, blurFilter].filter(Boolean).join(' ') || 'none';
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(clip.transform.flipH ? -1 : 1, clip.transform.flipV ? -1 : 1);
  try {
    ctx.drawImage(frame, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
  } catch {
    // A frame that is not decoded yet throws; skipping it is correct.
  }
  ctx.restore();

  if (board) {
    applyPostEffects(board.ctx, effects.post, width, height, time);
    target.save();
    target.globalAlpha = Math.min(1, Math.max(0, values.opacity * transition.alpha));
    if (transition.clip) {
      target.beginPath();
      target.rect(transition.clip.x, transition.clip.y, transition.clip.w, transition.clip.h);
      target.clip();
    }
    target.drawImage(board.canvas as CanvasImageSource, 0, 0);
    target.restore();
  }

  if (transition.flash > 0) {
    target.save();
    target.globalAlpha = transition.flash * 0.85;
    target.fillStyle = '#ffffff';
    target.fillRect(0, 0, width, height);
    target.restore();
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

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
      drawMediaClip(ctx, clip as MediaClip, time, provider, width, height, options.fastPreview ?? false);
    }
    ctx.restore();
  }
}
