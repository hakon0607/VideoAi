/**
 * Core editor domain model.
 *
 * Everything the editor can show or render is described by these types. The UI,
 * the AI tool layer, the renderer and the persistence layer all speak this same
 * shape, so there is exactly one source of truth for "what is a project".
 */

export type UUID = string;

/* -------------------------------------------------------------------------- */
/* Project settings                                                           */
/* -------------------------------------------------------------------------- */

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5', '4:3', '21:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface ProjectSettings {
  /** Canvas aspect ratio. Width/height are always kept consistent with it. */
  aspectRatio: AspectRatio;
  /** Render width in pixels. */
  width: number;
  /** Render height in pixels. */
  height: number;
  /** Frames per second used for playback, snapping and export. */
  fps: number;
  /** CSS colour painted behind every track. */
  backgroundColor: string;
  /** Audio sample rate used when mixing and exporting. */
  sampleRate: number;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: UUID;
  projectId: UUID;
  kind: MediaKind;
  name: string;
  /** Storage path inside the Supabase bucket. */
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  /** Seconds. 0 for images. */
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  sampleRate: number | null;
  channels: number | null;
  /** Normalised 0..1 peaks, one per bucket, used to draw waveforms. */
  waveform: number[] | null;
  /** Data URL or storage path for the poster frame. */
  thumbnailUrl: string | null;
  analysisStatus: AnalysisStatus;
  createdAt: string;
}

export type AnalysisStatus = 'pending' | 'basic' | 'transcribing' | 'analyzed' | 'failed';

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface SilenceSpan {
  start: number;
  end: number;
}

export interface MediaAnalysis {
  assetId: UUID;
  language: string | null;
  text: string | null;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  /** Detected silence spans in asset time, computed locally from the waveform. */
  silences: SilenceSpan[];
  /** Loudness in dBFS, used to reason about "make the voice louder". */
  loudnessDb: number | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Tracks                                                                     */
/* -------------------------------------------------------------------------- */

export const TRACK_KINDS = ['video', 'audio', 'text', 'overlay'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export interface Track {
  id: UUID;
  kind: TrackKind;
  name: string;
  /** Stacking order. 0 is the bottom-most track; higher indexes draw on top. */
  index: number;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  /** Track-level gain multiplier, 0..4. */
  volume: number;
  /** Row height in the timeline, pixels. */
  height: number;
}

/* -------------------------------------------------------------------------- */
/* Transform, effects, keyframes                                              */
/* -------------------------------------------------------------------------- */

export interface Transform {
  /** Horizontal offset from centre, as a fraction of frame width. */
  x: number;
  /** Vertical offset from centre, as a fraction of frame height. */
  y: number;
  /** Uniform scale, 1 = fit. */
  scale: number;
  /** Rotation in degrees, clockwise. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface CropRect {
  /** All values are fractions of the source frame, 0..1. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const EFFECT_TYPES = [
  'blur',
  'brightness',
  'contrast',
  'saturation',
  'grayscale',
  'sepia',
  'hue_rotate',
  'invert',
  'vignette',
  'sharpen',
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

export interface Effect {
  id: UUID;
  type: EffectType;
  enabled: boolean;
  /** Effect-specific numeric parameters. See lib/editor/effects.ts. */
  params: Record<string, number>;
}

export const KEYFRAMABLE_PROPERTIES = [
  'opacity',
  'scale',
  'x',
  'y',
  'rotation',
  'volume',
] as const;
export type KeyframeProperty = (typeof KEYFRAMABLE_PROPERTIES)[number] | `effect:${string}:${string}`;

export const EASINGS = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'hold'] as const;
export type Easing = (typeof EASINGS)[number];

export interface Keyframe {
  id: UUID;
  property: KeyframeProperty;
  /** Seconds relative to the start of the clip. */
  time: number;
  value: number;
  easing: Easing;
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                */
/* -------------------------------------------------------------------------- */

export const TRANSITION_TYPES = [
  'cut',
  'fade',
  'crossfade',
  'dissolve',
  'slide',
  'zoom',
  'wipe',
] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export interface Transition {
  id: UUID;
  type: TransitionType;
  /** Seconds. */
  duration: number;
  /** e.g. { direction: 'left' } for slide/wipe. */
  params: Record<string, string | number>;
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const TEXT_ANIMATIONS = ['none', 'fade', 'pop', 'slide_up', 'typewriter'] as const;
export type TextAnimation = (typeof TEXT_ANIMATIONS)[number];

export interface TextStyle {
  fontFamily: string;
  /** Font size as a fraction of frame height, so text scales with resolution. */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  align: TextAlign;
  lineHeight: number;
  letterSpacing: number;
  /** Background box behind the text. Transparent when alpha is 0. */
  backgroundColor: string;
  backgroundPadding: number;
  backgroundRadius: number;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  /** Max text box width, as a fraction of frame width. */
  maxWidth: number;
  uppercase: boolean;
}

/* -------------------------------------------------------------------------- */
/* Clips                                                                      */
/* -------------------------------------------------------------------------- */

export const CLIP_KINDS = ['video', 'audio', 'image', 'text'] as const;
export type ClipKind = (typeof CLIP_KINDS)[number];

/** Distinguishes hand-made text from generated caption lines. */
export type ClipRole = 'default' | 'caption';

interface ClipCommon {
  id: UUID;
  trackId: UUID;
  name: string;
  /** Position on the timeline, in seconds. */
  start: number;
  /** Length on the timeline, in seconds (already accounts for speed). */
  duration: number;
  locked: boolean;
  opacity: number;
  transform: Transform;
  effects: Effect[];
  keyframes: Keyframe[];
  transitionIn: Transition | null;
  transitionOut: Transition | null;
  role: ClipRole;
  /** Groups generated caption lines so they can be edited or removed together. */
  groupId: UUID | null;
}

export interface MediaClip extends ClipCommon {
  kind: 'video' | 'audio' | 'image';
  assetId: UUID;
  /** Offset into the source asset where this clip starts, in seconds. */
  sourceIn: number;
  /** Playback rate. 1 = normal. Negative values are not allowed; use `reversed`. */
  speed: number;
  reversed: boolean;
  /** Linear gain, 0..4. */
  volume: number;
  muted: boolean;
  /** Seconds. */
  fadeIn: number;
  fadeOut: number;
  crop: CropRect | null;
  /** When true the clip holds a single frame (freeze frame). */
  freeze: boolean;
}

export interface TextClip extends ClipCommon {
  kind: 'text';
  text: string;
  style: TextStyle;
  animation: TextAnimation;
}

export type Clip = MediaClip | TextClip;

export function isMediaClip(clip: Clip): clip is MediaClip {
  return clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'image';
}

export function isTextClip(clip: Clip): clip is TextClip {
  return clip.kind === 'text';
}

/* -------------------------------------------------------------------------- */
/* Editor state                                                               */
/* -------------------------------------------------------------------------- */

export interface EditorState {
  projectId: UUID;
  timelineId: UUID;
  name: string;
  settings: ProjectSettings;
  tracks: Track[];
  clips: Clip[];
  assets: MediaAsset[];
  /** Analysis keyed by asset id. Read-only for the engine; AI reads it. */
  analysis: Record<UUID, MediaAnalysis>;
  /** Monotonic counter bumped on every applied transaction. */
  revision: number;
}

/** Volatile UI state that is not part of the undo history. */
export interface EditorSelection {
  clipIds: UUID[];
  trackId: UUID | null;
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

export const EXPORT_FORMATS = ['mp4', 'webm'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_QUALITIES = ['low', 'medium', 'high', 'very_high'] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  format: ExportFormat;
  quality: ExportQuality;
  includeAudio: boolean;
  /** Optional sub-range of the timeline. */
  rangeStart: number | null;
  rangeEnd: number | null;
}

export type ExportStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';

export interface ExportJob {
  id: UUID;
  projectId: UUID;
  status: ExportStatus;
  progress: number;
  settings: ExportSettings;
  engine: 'browser' | 'server';
  outputPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}
