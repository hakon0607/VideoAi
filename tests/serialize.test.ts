import { describe, expect, it } from 'vitest';
import { applyActions } from '@/lib/editor/engine';
import { toSavePayload } from '@/lib/editor/serialize';
import { clipFromRow, effectFromRow, keyframeFromRow, trackFromRow } from '@/lib/editor/serialize';
import type { Tables } from '@/types/database';
import { stateWithVideo, testContext, TRACK_IDS } from './helpers';
import type { MediaClip, TextClip } from '@/types/editor';

describe('save payload', () => {
  it('carries every field the SQL function reads', () => {
    const ctx = testContext();
    const built = applyActions(
      stateWithVideo(40),
      [
        { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', duration: 12 } },
        { type: 'add_text', params: { trackId: TRACK_IDS[2], text: 'Hello', start: 1, duration: 3 } },
      ],
      ctx,
    ).state;
    const clipId = built.clips[0].id;
    const state = applyActions(
      built,
      [
        { type: 'add_effect', params: { clipId, type: 'blur', params: { radius: 6 } } },
        { type: 'animate_property', params: { clipId, property: 'scale', from: 1, to: 1.2 } },
        { type: 'add_transition', params: { clipId, position: 'out', type: 'crossfade', duration: 0.6 } },
        { type: 'set_crop', params: { clipId, left: 0.1, right: 0.1 } },
      ],
      ctx,
    ).state;

    const payload = toSavePayload(state, 'user/u/projects/p/thumbnail.jpg');
    expect(payload.projectId).toBe(state.projectId);
    expect(payload.timelineId).toBe(state.timelineId);
    expect(payload.duration).toBeCloseTo(12);
    expect(payload.tracks).toHaveLength(3);
    expect(payload.clips).toHaveLength(2);

    const media = payload.clips[0] as Record<string, unknown>;
    expect(media.assetId).toBe('asset-1');
    expect(media.sourceIn).toBe(0);
    expect(media.speed).toBe(1);
    expect(media.freeze).toBe(false);
    expect(media.crop).toEqual({ left: 0.1, top: 0, right: 0.1, bottom: 0 });
    expect((media.effects as unknown[]).length).toBe(1);
    expect((media.keyframes as unknown[]).length).toBe(2);
    expect((media.transitionOut as { type: string }).type).toBe('crossfade');

    const text = payload.clips[1] as Record<string, unknown>;
    expect(text.text).toBe('Hello');
    expect(text.style).toBeTypeOf('object');
    expect(text.animation).toBeTypeOf('string');
  });
});

function baseRow(): Tables<'clips'> {
  return {
    id: 'clip-1',
    timeline_id: 't1',
    track_id: 'track-1',
    project_id: 'p1',
    asset_id: 'asset-1',
    kind: 'video',
    role: 'default',
    group_id: null,
    name: 'Shot',
    start_time: 2.5,
    duration: 8,
    source_in: 1.25,
    speed: 1.5,
    reversed: true,
    freeze_frame: false,
    volume: 0.8,
    muted: false,
    fade_in: 0.2,
    fade_out: 0.4,
    opacity: 0.9,
    locked: false,
    transform: { x: 0.1, y: -0.2, scale: 1.4, rotation: 15, flipH: true, flipV: false },
    crop: { left: 0.05, top: 0, right: 0.05, bottom: 0 },
    text_content: null,
    text_style: null,
    text_animation: null,
    transition_in: null,
    transition_out: { id: 'tr1', type: 'fade', duration: 0.5, params: {} },
    created_at: new Date(0).toISOString(),
  };
}

describe('database rows to editor state', () => {
  it('restores a media clip exactly', () => {
    const clip = clipFromRow(baseRow(), [], []) as MediaClip;
    expect(clip.kind).toBe('video');
    expect(clip.start).toBe(2.5);
    expect(clip.speed).toBe(1.5);
    expect(clip.reversed).toBe(true);
    expect(clip.transform.rotation).toBe(15);
    expect(clip.transform.flipH).toBe(true);
    expect(clip.crop?.left).toBe(0.05);
    expect(clip.transitionOut?.type).toBe('fade');
  });

  it('restores a text clip with defaults filled in', () => {
    const row: Tables<'clips'> = {
      ...baseRow(),
      kind: 'text',
      asset_id: null,
      text_content: 'Caption line',
      text_style: { fontSize: 0.06, color: '#ff0000' },
      text_animation: 'pop',
      role: 'caption',
      group_id: 'group-1',
    };
    const clip = clipFromRow(row, [], []) as TextClip;
    expect(clip.text).toBe('Caption line');
    expect(clip.style.fontSize).toBe(0.06);
    expect(clip.style.color).toBe('#ff0000');
    // Anything the stored style omitted falls back to the default.
    expect(clip.style.fontFamily).toContain('Inter');
    expect(clip.role).toBe('caption');
    expect(clip.groupId).toBe('group-1');
  });

  it('restores tracks, effects and keyframes', () => {
    const track = trackFromRow({
      id: 'track-1',
      timeline_id: 't1',
      project_id: 'p1',
      kind: 'audio',
      name: 'Music',
      layer_index: 2,
      muted: true,
      hidden: false,
      locked: false,
      volume: 0.5,
      height: 56,
      created_at: new Date(0).toISOString(),
    });
    expect(track.index).toBe(2);
    expect(track.muted).toBe(true);

    const effect = effectFromRow({
      id: 'e1',
      clip_id: 'clip-1',
      project_id: 'p1',
      type: 'vignette',
      enabled: true,
      order_index: 0,
      params: { amount: 0.5, softness: 0.7 },
      created_at: new Date(0).toISOString(),
    });
    expect(effect.params.amount).toBe(0.5);

    const keyframe = keyframeFromRow({
      id: 'k1',
      clip_id: 'clip-1',
      project_id: 'p1',
      property: 'scale',
      time_offset: 1.5,
      value: 1.3,
      easing: 'ease_out',
      created_at: new Date(0).toISOString(),
    });
    expect(keyframe.time).toBe(1.5);
    expect(keyframe.easing).toBe('ease_out');
  });
});
