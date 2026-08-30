import { describe, expect, it } from 'vitest';
import { applyAction, applyActions, ACTION_TYPES } from '@/lib/editor/engine';
import { EditorError } from '@/lib/editor/errors';
import { clipEnd } from '@/lib/editor/time';
import { timelineDuration } from '@/lib/editor/selectors';
import { isMediaClip } from '@/types/editor';
import { stateWithVideo, testContext, TRACK_IDS } from './helpers';

function withClip(duration = 60) {
  const ctx = testContext();
  const base = stateWithVideo(duration);
  const { state } = applyAction(
    base,
    { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111' } },
    ctx,
  );
  return { state, ctx, clipId: state.clips[0].id };
}

describe('action registry', () => {
  it('exposes a broad command surface', () => {
    expect(ACTION_TYPES.length).toBeGreaterThan(40);
    expect(ACTION_TYPES).toContain('split_clip');
    expect(ACTION_TYPES).toContain('remove_ranges');
    expect(ACTION_TYPES).toContain('add_captions');
  });

  it('rejects unknown actions with a structured error', () => {
    const state = stateWithVideo();
    expect(() => applyAction(state, { type: 'launch_missiles', params: {} })).toThrowError(EditorError);
  });
});

describe('create_clip', () => {
  it('uses the full asset duration by default', () => {
    const { state } = withClip(42);
    expect(state.clips).toHaveLength(1);
    expect(state.clips[0].duration).toBeCloseTo(42);
    expect(state.clips[0].start).toBe(0);
  });

  it('appends after the previous clip', () => {
    const { state, ctx } = withClip(10);
    const next = applyAction(state, { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111' } }, ctx);
    expect(next.state.clips[1].start).toBeCloseTo(10);
  });

  it('refuses an asset that is not in the project', () => {
    const state = stateWithVideo();
    expect(() =>
      applyAction(state, { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'deadbeef-0000-4000-8000-000000000000' } }),
    ).toThrowError(/No media asset/);
  });

  it('refuses a video clip on an audio track', () => {
    const state = stateWithVideo();
    expect(() =>
      applyAction(state, { type: 'create_clip', params: { trackId: TRACK_IDS[1], assetId: 'a5501111-1111-4111-8111-111111111111' } }),
    ).toThrowError(/cannot go on a audio track/);
  });
});

describe('split_clip', () => {
  it('produces two halves that keep source continuity', () => {
    const { state, ctx, clipId } = withClip(20);
    const result = applyAction(state, { type: 'split_clip', params: { clipId, time: 8 } }, ctx);
    const [left, right] = result.state.clips;
    expect(left.duration).toBeCloseTo(8);
    expect(right.start).toBeCloseTo(8);
    expect(right.duration).toBeCloseTo(12);
    if (isMediaClip(right)) expect(right.sourceIn).toBeCloseTo(8);
  });

  it('rejects a split outside the clip', () => {
    const { state, clipId } = withClip(20);
    expect(() => applyAction(state, { type: 'split_clip', params: { clipId, time: 40 } })).toThrowError(/not inside/);
  });
});

describe('remove_ranges', () => {
  it('removes several pauses and closes the gaps', () => {
    const { state, ctx, clipId } = withClip(30);
    void clipId;
    const result = applyAction(
      state,
      {
        type: 'remove_ranges',
        params: {
          ranges: [
            { start: 5, end: 7 },
            { start: 12, end: 15 },
            { start: 20, end: 22.5 },
          ],
          ripple: true,
        },
      },
      ctx,
    );
    // 7.5 seconds removed from a 30 second timeline.
    expect(timelineDuration(result.state)).toBeCloseTo(22.5, 3);
    // No gaps between the surviving pieces.
    const sorted = [...result.state.clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].start).toBeCloseTo(clipEnd(sorted[i - 1]), 3);
    }
  });

  it('keeps source alignment after the cuts', () => {
    const { state, ctx } = withClip(30);
    const result = applyAction(
      state,
      { type: 'remove_ranges', params: { ranges: [{ start: 10, end: 12 }], ripple: true } },
      ctx,
    );
    const sorted = [...result.state.clips].sort((a, b) => a.start - b.start);
    const second = sorted[1];
    expect(isMediaClip(second) && second.sourceIn).toBeCloseTo(12);
  });
});

describe('set_clip_speed', () => {
  it('shortens the clip and ripples the ones after it', () => {
    const { state, ctx } = withClip(10);
    const second = applyAction(
      state,
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111' } },
      ctx,
    ).state;
    const first = second.clips[0];
    const result = applyAction(second, { type: 'set_clip_speed', params: { clipId: first.id, speed: 2 } }, ctx);
    expect(result.state.clips[0].duration).toBeCloseTo(5);
    expect(result.state.clips[1].start).toBeCloseTo(5);
  });
});

describe('set_timeline_duration', () => {
  it('fits the timeline to an exact length', () => {
    const { state, ctx } = withClip(60);
    const result = applyAction(state, { type: 'set_timeline_duration', params: { duration: 30 } }, ctx);
    expect(timelineDuration(result.state)).toBeCloseTo(30, 3);
  });
});

describe('applyActions', () => {
  it('runs a chain and bumps the revision once', () => {
    const { state, ctx, clipId } = withClip(30);
    const result = applyActions(
      state,
      [
        { type: 'split_clip', params: { clipId, time: 10 } },
        { type: 'set_aspect_ratio', params: { aspectRatio: '9:16' } },
        { type: 'add_effect', params: { clipId, type: 'saturation', params: { amount: 1.3 } } },
      ],
      ctx,
    );
    expect(result.state.clips).toHaveLength(2);
    expect(result.state.settings.aspectRatio).toBe('9:16');
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.applied).toHaveLength(3);
  });

  it('fills in generated ids so the batch replays identically', () => {
    const { state, ctx, clipId } = withClip(30);
    const result = applyActions(state, [{ type: 'split_clip', params: { clipId, time: 10 } }], ctx);
    const normalized = result.applied[0].action;
    expect(normalized.params.newClipId).toBeTypeOf('string');
    // Replaying the normalized action on the original state gives the same ids.
    const replay = applyActions(state, [normalized], testContext());
    expect(replay.state.clips.map((c) => c.id).sort()).toEqual(result.state.clips.map((c) => c.id).sort());
  });
});

describe('automatic track stacking', () => {
  it('puts an overlapping clip on a new track instead of hiding it', () => {
    const ctx = testContext();
    const base = stateWithVideo(60);
    const first = applyAction(
      base,
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 0, duration: 10 } },
      ctx,
    ).state;

    // The same spot is taken, and there is no other video track.
    const second = applyAction(
      first,
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 2, duration: 6 } },
      ctx,
    ).state;

    expect(second.tracks).toHaveLength(4);
    expect(second.clips[1].trackId).not.toBe(second.clips[0].trackId);
    const created = second.tracks.find((t) => t.id === second.clips[1].trackId);
    expect(created?.kind).toBe('video');
  });

  it('reuses an existing free track before adding another', () => {
    const ctx = testContext();
    const withTrack = applyAction(stateWithVideo(60), { type: 'create_track', params: { kind: 'video' } }, ctx).state;
    const extraTrackId = withTrack.tracks[withTrack.tracks.length - 1].id;

    const first = applyAction(
      withTrack,
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 0, duration: 10 } },
      ctx,
    ).state;
    const second = applyAction(
      first,
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 1, duration: 5 } },
      ctx,
    ).state;

    expect(second.tracks).toHaveLength(withTrack.tracks.length);
    expect(second.clips[1].trackId).toBe(extraTrackId);
  });

  it('leaves a non-overlapping clip on the requested track', () => {
    const ctx = testContext();
    const first = applyAction(
      stateWithVideo(60),
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 0, duration: 10 } },
      ctx,
    ).state;
    const second = applyAction(
      first,
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 10, duration: 5 } },
      ctx,
    ).state;
    expect(second.tracks).toHaveLength(3);
    expect(second.clips[1].trackId).toBe(TRACK_IDS[0]);
  });

  it('cannot be turned off: a clip is never hidden behind another', () => {
    const ctx = testContext();
    const first = applyAction(
      stateWithVideo(60),
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 0, duration: 10 } },
      ctx,
    ).state;
    // `stack: false` used to mean "put it there anyway"; an unknown key is now
    // ignored and the clip still lands on a lane of its own.
    const second = applyAction(
      first,
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 2, duration: 4, stack: false } },
      ctx,
    ).state;
    expect(second.tracks).toHaveLength(4);
    expect(second.clips[1].trackId).not.toBe(TRACK_IDS[0]);
  });

  it('stacks text the same way', () => {
    const ctx = testContext();
    const first = applyAction(
      stateWithVideo(60),
      { type: 'add_text', params: { trackId: TRACK_IDS[2], text: 'One', start: 0, duration: 4 } },
      ctx,
    ).state;
    const second = applyAction(
      first,
      { type: 'add_text', params: { trackId: TRACK_IDS[2], text: 'Two', start: 1, duration: 4 } },
      ctx,
    ).state;
    expect(second.clips[1].trackId).not.toBe(second.clips[0].trackId);
    expect(second.tracks.filter((t) => t.kind === 'text')).toHaveLength(2);
  });
});
