import type {
  AspectRatio,
  Clip,
  EditorState,
  Effect,
  EffectType,
  MediaClip,
  ProjectSettings,
  TextClip,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  Transition,
  TransitionType,
} from '@/types/editor';

export const DEFAULT_FPS = 30;

/** Canonical resolutions per aspect ratio, keyed by the short edge. */
export const RESOLUTION_PRESETS: Record<AspectRatio, { label: string; width: number; height: number }[]> = {
  '16:9': [
    { label: '720p', width: 1280, height: 720 },
    { label: '1080p', width: 1920, height: 1080 },
    { label: '1440p', width: 2560, height: 1440 },
    { label: '4K', width: 3840, height: 2160 },
  ],
  '9:16': [
    { label: '720p', width: 720, height: 1280 },
    { label: '1080p', width: 1080, height: 1920 },
    { label: '1440p', width: 1440, height: 2560 },
  ],
  '1:1': [
    { label: '720p', width: 720, height: 720 },
    { label: '1080p', width: 1080, height: 1080 },
  ],
  '4:5': [
    { label: '1080p', width: 1080, height: 1350 },
  ],
  '4:3': [
    { label: '720p', width: 960, height: 720 },
    { label: '1080p', width: 1440, height: 1080 },
  ],
  '21:9': [
    { label: '1080p', width: 2560, height: 1080 },
    { label: '4K', width: 3840, height: 1600 },
  ],
};

export interface ProjectPreset {
  id: string;
  label: string;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: number;
}

export const PROJECT_PRESETS: ProjectPreset[] = [
  { id: 'youtube_1080p', label: 'YouTube 16:9 · 1080p', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30 },
  { id: 'youtube_4k', label: 'YouTube 16:9 · 4K', aspectRatio: '16:9', width: 3840, height: 2160, fps: 30 },
  { id: 'shorts', label: 'YouTube Shorts 9:16', aspectRatio: '9:16', width: 1080, height: 1920, fps: 30 },
  { id: 'tiktok', label: 'TikTok 9:16', aspectRatio: '9:16', width: 1080, height: 1920, fps: 30 },
  { id: 'reels', label: 'Instagram Reels 9:16', aspectRatio: '9:16', width: 1080, height: 1920, fps: 30 },
  { id: 'instagram_square', label: 'Instagram 1:1', aspectRatio: '1:1', width: 1080, height: 1080, fps: 30 },
  { id: 'instagram_portrait', label: 'Instagram 4:5', aspectRatio: '4:5', width: 1080, height: 1350, fps: 30 },
  { id: 'cinematic', label: 'Cinematic 21:9', aspectRatio: '21:9', width: 2560, height: 1080, fps: 24 },
];

export const ASPECT_RATIO_VALUES: Record<AspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
};

export function defaultSettings(): ProjectSettings {
  return {
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    fps: DEFAULT_FPS,
    backgroundColor: '#000000',
    sampleRate: 48000,
  };
}

/** Picks the closest standard resolution for an aspect ratio, keeping pixel count. */
export function resolutionForAspect(aspect: AspectRatio, currentHeight: number): { width: number; height: number } {
  const presets = RESOLUTION_PRESETS[aspect];
  let best = presets[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const preset of presets) {
    const delta = Math.abs(preset.height - currentHeight);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = preset;
    }
  }
  return { width: best.width, height: best.height };
}

export function defaultTransform(): Transform {
  return { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false };
}

export function defaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 0.07,
    fontWeight: 700,
    italic: false,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    backgroundColor: 'rgba(0,0,0,0)',
    backgroundPadding: 0.02,
    backgroundRadius: 0.01,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowColor: 'rgba(0,0,0,0.55)',
    shadowBlur: 0.01,
    shadowOffsetY: 0.004,
    maxWidth: 0.8,
    uppercase: false,
  };
}

export function captionTextStyle(): TextStyle {
  return {
    ...defaultTextStyle(),
    fontSize: 0.055,
    fontWeight: 800,
    maxWidth: 0.82,
    strokeWidth: 0.004,
    backgroundColor: 'rgba(0,0,0,0)',
  };
}

/** Neutral parameter set per effect type. Values are the identity/no-op point. */
export const EFFECT_DEFAULTS: Record<EffectType, Record<string, number>> = {
  blur: { radius: 4 },
  brightness: { amount: 1.1 },
  contrast: { amount: 1.15 },
  saturation: { amount: 1.25 },
  grayscale: { amount: 1 },
  sepia: { amount: 1 },
  hue_rotate: { degrees: 30 },
  invert: { amount: 1 },
  vignette: { amount: 0.4, softness: 0.6 },
  sharpen: { amount: 0.6 },
};

/** Allowed numeric ranges, enforced by the action schemas. */
export const EFFECT_RANGES: Record<EffectType, Record<string, [number, number]>> = {
  blur: { radius: [0, 100] },
  brightness: { amount: [0, 4] },
  contrast: { amount: [0, 4] },
  saturation: { amount: [0, 4] },
  grayscale: { amount: [0, 1] },
  sepia: { amount: [0, 1] },
  hue_rotate: { degrees: [-360, 360] },
  invert: { amount: [0, 1] },
  vignette: { amount: [0, 1], softness: [0.05, 1] },
  sharpen: { amount: [0, 2] },
};

export const TRANSITION_DEFAULT_DURATION = 0.5;

export function defaultTransition(type: TransitionType, id: string, duration?: number): Transition {
  return {
    id,
    type,
    duration: duration ?? TRANSITION_DEFAULT_DURATION,
    params: type === 'slide' || type === 'wipe' ? { direction: 'left' } : {},
  };
}

export function defaultTrack(id: string, kind: TrackKind, index: number, name?: string): Track {
  return {
    id,
    kind,
    name: name ?? defaultTrackName(kind, index),
    index,
    muted: false,
    hidden: false,
    locked: false,
    volume: 1,
    height: kind === 'audio' ? 56 : 68,
  };
}

export function defaultTrackName(kind: TrackKind, index: number): string {
  const label: Record<TrackKind, string> = {
    video: 'Video',
    audio: 'Audio',
    text: 'Text',
    overlay: 'Overlay',
  };
  return `${label[kind]} ${index + 1}`;
}

export function baseClipFields(id: string, trackId: string, start: number, duration: number, name: string) {
  return {
    id,
    trackId,
    name,
    start,
    duration,
    locked: false,
    opacity: 1,
    transform: defaultTransform(),
    effects: [] as Effect[],
    keyframes: [],
    transitionIn: null,
    transitionOut: null,
    role: 'default' as const,
    groupId: null,
  };
}

export function emptyState(projectId: string, timelineId: string, name: string, trackIds: [string, string, string]): EditorState {
  return {
    projectId,
    timelineId,
    name,
    settings: defaultSettings(),
    tracks: [
      defaultTrack(trackIds[0], 'video', 0),
      defaultTrack(trackIds[1], 'audio', 1),
      defaultTrack(trackIds[2], 'text', 2),
    ],
    clips: [],
    assets: [],
    analysis: {},
    revision: 0,
  };
}

/** True when the clip kind can live on the track kind. */
export function clipFitsTrack(clipKind: Clip['kind'], trackKind: TrackKind): boolean {
  if (trackKind === 'audio') return clipKind === 'audio';
  if (trackKind === 'text') return clipKind === 'text';
  if (trackKind === 'video') return clipKind === 'video' || clipKind === 'image';
  return true; // overlay accepts anything visual
}

export function isAudibleClip(clip: Clip): clip is MediaClip {
  return (clip.kind === 'video' || clip.kind === 'audio') && !(clip as MediaClip).muted;
}

export function isVisualClip(clip: Clip): clip is MediaClip | TextClip {
  return clip.kind !== 'audio';
}
