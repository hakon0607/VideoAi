import type {
  Clip,
  EditorState,
  Effect,
  Keyframe,
  MediaAnalysis,
  MediaAsset,
  MediaClip,
  TextClip,
  Track,
  Transform,
  Transition,
} from '@/types/editor';
import type { Json, Tables } from '@/types/database';
import { defaultTextStyle, defaultTransform } from './defaults';
import { timelineDuration } from './selectors';

/* -------------------------------------------------------------------------- */
/* Database -> editor state                                                   */
/* -------------------------------------------------------------------------- */

function asRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toTransform(value: Json | null): Transform {
  const raw = asRecord(value);
  const base = defaultTransform();
  return {
    x: typeof raw.x === 'number' ? raw.x : base.x,
    y: typeof raw.y === 'number' ? raw.y : base.y,
    scale: typeof raw.scale === 'number' ? raw.scale : base.scale,
    rotation: typeof raw.rotation === 'number' ? raw.rotation : base.rotation,
    flipH: Boolean(raw.flipH),
    flipV: Boolean(raw.flipV),
  };
}

function toTransition(value: Json | null): Transition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== 'string') return null;
  return {
    id: String(raw.id ?? ''),
    type: raw.type as Transition['type'],
    duration: Number(raw.duration ?? 0.5),
    params: (raw.params as Record<string, string | number>) ?? {},
  };
}

export function trackFromRow(row: Tables<'tracks'>): Track {
  return {
    id: row.id,
    kind: row.kind as Track['kind'],
    name: row.name,
    index: row.layer_index,
    muted: row.muted,
    hidden: row.hidden,
    locked: row.locked,
    volume: Number(row.volume),
    height: row.height,
  };
}

export function assetFromRow(row: Tables<'media_assets'>): MediaAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as MediaAsset['kind'],
    name: row.name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    duration: Number(row.duration_seconds),
    width: row.width,
    height: row.height,
    fps: row.fps === null ? null : Number(row.fps),
    hasAudio: row.has_audio,
    sampleRate: row.sample_rate,
    channels: row.channels,
    waveform: Array.isArray(row.waveform) ? (row.waveform as number[]) : null,
    thumbnailUrl: row.thumbnail_url,
    analysisStatus: row.analysis_status as MediaAsset['analysisStatus'],
    createdAt: row.created_at,
  };
}

export function analysisFromRow(row: Tables<'media_analysis'>): MediaAnalysis {
  return {
    assetId: row.asset_id,
    language: row.language,
    text: row.transcript_text,
    words: Array.isArray(row.words) ? (row.words as unknown as MediaAnalysis['words']) : [],
    segments: Array.isArray(row.segments) ? (row.segments as unknown as MediaAnalysis['segments']) : [],
    silences: Array.isArray(row.silences) ? (row.silences as unknown as MediaAnalysis['silences']) : [],
    loudnessDb: row.loudness_db === null ? null : Number(row.loudness_db),
    createdAt: row.created_at,
  };
}

export function clipFromRow(
  row: Tables<'clips'>,
  effects: Effect[],
  keyframes: Keyframe[],
): Clip {
  const common = {
    id: row.id,
    trackId: row.track_id,
    name: row.name,
    start: Number(row.start_time),
    duration: Number(row.duration),
    locked: row.locked,
    opacity: Number(row.opacity),
    transform: toTransform(row.transform),
    effects,
    keyframes,
    transitionIn: toTransition(row.transition_in),
    transitionOut: toTransition(row.transition_out),
    role: (row.role as Clip['role']) ?? 'default',
    groupId: row.group_id,
  };

  if (row.kind === 'text') {
    const style = asRecord(row.text_style);
    const clip: TextClip = {
      ...common,
      kind: 'text',
      text: row.text_content ?? '',
      style: { ...defaultTextStyle(), ...(style as Partial<TextClip['style']>) },
      animation: (row.text_animation as TextClip['animation']) ?? 'none',
    };
    return clip;
  }

  const crop = row.crop ? asRecord(row.crop) : null;
  const clip: MediaClip = {
    ...common,
    kind: row.kind as MediaClip['kind'],
    assetId: row.asset_id as string,
    sourceIn: Number(row.source_in),
    speed: Number(row.speed),
    reversed: row.reversed,
    volume: Number(row.volume),
    muted: row.muted,
    fadeIn: Number(row.fade_in),
    fadeOut: Number(row.fade_out),
    crop: crop
      ? {
          left: Number(crop.left ?? 0),
          top: Number(crop.top ?? 0),
          right: Number(crop.right ?? 0),
          bottom: Number(crop.bottom ?? 0),
        }
      : null,
    freeze: row.freeze_frame,
  };
  return clip;
}

export function effectFromRow(row: Tables<'effects'>): Effect {
  return {
    id: row.id,
    type: row.type as Effect['type'],
    enabled: row.enabled,
    params: (asRecord(row.params) as Record<string, number>) ?? {},
  };
}

export function keyframeFromRow(row: Tables<'keyframes'>): Keyframe {
  return {
    id: row.id,
    property: row.property as Keyframe['property'],
    time: Number(row.time_offset),
    value: Number(row.value),
    easing: row.easing as Keyframe['easing'],
  };
}

/* -------------------------------------------------------------------------- */
/* Editor state -> save_timeline payload                                      */
/* -------------------------------------------------------------------------- */

export interface SavePayload {
  projectId: string;
  timelineId: string;
  name: string;
  duration: number;
  thumbnailPath?: string | null;
  settings: EditorState['settings'];
  tracks: unknown[];
  clips: unknown[];
}

/** Serialises the whole timeline for the atomic save_timeline RPC. */
export function toSavePayload(state: EditorState, thumbnailPath?: string | null): SavePayload {
  return {
    projectId: state.projectId,
    timelineId: state.timelineId,
    name: state.name,
    duration: timelineDuration(state),
    thumbnailPath: thumbnailPath ?? null,
    settings: state.settings,
    tracks: state.tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      index: t.index,
      muted: t.muted,
      hidden: t.hidden,
      locked: t.locked,
      volume: t.volume,
      height: t.height,
    })),
    clips: state.clips.map((clip) => {
      const base = {
        id: clip.id,
        trackId: clip.trackId,
        kind: clip.kind,
        role: clip.role,
        groupId: clip.groupId,
        name: clip.name,
        start: clip.start,
        duration: clip.duration,
        opacity: clip.opacity,
        locked: clip.locked,
        transform: clip.transform,
        transitionIn: clip.transitionIn,
        transitionOut: clip.transitionOut,
        effects: clip.effects,
        keyframes: clip.keyframes,
      };
      if (clip.kind === 'text') {
        return { ...base, text: clip.text, style: clip.style, animation: clip.animation };
      }
      const media = clip as MediaClip;
      return {
        ...base,
        assetId: media.assetId,
        sourceIn: media.sourceIn,
        speed: media.speed,
        reversed: media.reversed,
        freeze: media.freeze,
        volume: media.volume,
        muted: media.muted,
        fadeIn: media.fadeIn,
        fadeOut: media.fadeOut,
        crop: media.crop,
      };
    }),
  };
}
