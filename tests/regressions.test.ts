/**
 * One test per bug the stress testing turned up, so none of them can come back.
 * Each name describes the thing that used to go wrong.
 */
import { describe, expect, it } from 'vitest';
import type { EditorState } from '@/types/editor';
import { emptyState } from '@/lib/editor/defaults';
import { applyActions } from '@/lib/editor/engine';
import { EditorError } from '@/lib/editor/errors';
import { clipEnd } from '@/lib/editor/time';
import { testContext, TRACK_IDS, videoAsset } from './helpers';

const VIDEO = 'a5501111-1111-4111-8111-111111111111';
const MUSIC = 'a5502222-2222-4222-8222-222222222222';

function project(): EditorState {
  const base = emptyState(
    'p9001111-1111-4111-8111-111111111111',
    'p9001111-1111-4111-8111-111111111112',
    'Regression',
    TRACK_IDS,
  );
  return {
    ...base,
    assets: [videoAsset(VIDEO, 60), { ...videoAsset(MUSIC, 60), kind: 'audio', name: 'music.m4a' }],
  };
}

/** No two clips on one track may ever be on screen at the same moment. */
function expectNoOverlap(state: EditorState): void {
  for (const track of state.tracks) {
    const onTrack = state.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    for (let i = 1; i < onTrack.length; i += 1) {
      expect(onTrack[i].start, `overlap on ${track.name}`).toBeGreaterThanOrEqual(clipEnd(onTrack[i - 1]) - 0.002);
    }
  }
}

describe('nothing is ever hidden behind something else', () => {
  it('moves a clip to a free lane instead of dropping it on top of another', () => {
    const ctx = testContext();
    const state = applyActions(project(), [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 0, duration: 10 } },
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 20, duration: 10 } },
    ], ctx).state;

    const second = state.clips[1];
    const moved = applyActions(state, [{ type: 'move_clip', params: { clipId: second.id, start: 2 } }], ctx).state;

    expect(moved.clips.find((c) => c.id === second.id)?.trackId).not.toBe(TRACK_IDS[0]);
    expectNoOverlap(moved);
  });

  it('adds captions beside a title that is already on the text track', () => {
    const ctx = testContext();
    const state = applyActions(project(), [
      { type: 'add_text', params: { trackId: TRACK_IDS[2], text: 'Title', start: 0, duration: 12 } },
    ], ctx).state;

    const captioned = applyActions(state, [
      {
        type: 'add_captions',
        params: {
          trackId: TRACK_IDS[2],
          lines: [
            { start: 1, end: 3, text: 'first line' },
            { start: 3.2, end: 5, text: 'second line' },
          ],
        },
      },
    ], ctx).state;

    expect(captioned.clips).toHaveLength(3);
    expectNoOverlap(captioned);
  });

  it('puts several sounds that land on the same beat on their own lanes', () => {
    const result = applyActions(project(), [
      {
        type: 'add_sound_effects',
        params: {
          sounds: [
            { sound: 'whoosh', start: 1 },
            { sound: 'impact', start: 1.05 },
            { sound: 'ding', start: 1.1 },
            { sound: 'pop', start: 1.15 },
          ],
        },
      },
    ], testContext()).state;

    expect(result.clips).toHaveLength(4);
    expectNoOverlap(result);
  });

  it('detaches audio beside the music instead of underneath it', () => {
    const ctx = testContext();
    const state = applyActions(project(), [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 0, duration: 10 } },
      { type: 'create_clip', params: { trackId: TRACK_IDS[1], assetId: MUSIC, start: 0, duration: 30 } },
    ], ctx).state;

    const detached = applyActions(state, [
      { type: 'detach_audio', params: { clipId: state.clips[0].id, trackId: TRACK_IDS[1] } },
    ], ctx).state;

    expect(detached.clips).toHaveLength(3);
    expectNoOverlap(detached);
  });
});

describe('locking means locked', () => {
  it('does not slide a clip under a locked one when closing a gap', () => {
    const ctx = testContext();
    const state = applyActions(project(), [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 0, duration: 5 } },
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 20, duration: 5 } },
    ], ctx).state;

    const locked = applyActions(state, [
      { type: 'set_clip_properties', params: { clipId: state.clips[0].id, locked: true } },
    ], ctx).state;

    const cut = applyActions(locked, [
      { type: 'remove_range', params: { start: 6, end: 19, ripple: true } },
    ], ctx).state;

    expectNoOverlap(cut);
    expect(cut.clips.find((c) => c.id === state.clips[0].id)?.start).toBe(0);
  });

  it('refuses to edit a clip on a locked track', () => {
    const ctx = testContext();
    const state = applyActions(project(), [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 0, duration: 5 } },
      { type: 'set_track_properties', params: { trackId: TRACK_IDS[0], locked: true } },
    ], ctx).state;

    expect(() =>
      applyActions(state, [{ type: 'trim_clip', params: { clipId: state.clips[0].id, end: 3 } }], ctx),
    ).toThrow(/locked/i);
  });
});

describe('bad parameters are refused, never stored', () => {
  it('rejects a clip kind that cannot live on the requested track', () => {
    const ctx = testContext();
    const state = applyActions(project(), [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 0, duration: 5 } },
    ], ctx).state;

    expect(() =>
      applyActions(state, [
        { type: 'reorder_clips', params: { trackId: TRACK_IDS[2], clipIds: [state.clips[0].id] } },
      ], ctx),
    ).toThrow(EditorError);
  });

  it('refuses a speed that would leave the clip too short to see', () => {
    const ctx = testContext();
    const state = applyActions(project(), [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 0, duration: 0.2 } },
    ], ctx).state;

    expect(() =>
      applyActions(state, [{ type: 'set_clip_speed', params: { clipId: state.clips[0].id, speed: 20 } }], ctx),
    ).toThrow(/too short/i);
  });

  it('refuses an id that is not a uuid rather than failing at save time', () => {
    expect(() =>
      applyActions(project(), [{ type: 'delete_clip', params: { clipId: 'clip-3' } }], testContext()),
    ).toThrow(/Invalid parameters/);
  });

  it('rejects an action that would give two objects the same id', () => {
    const ctx = testContext();
    const state = applyActions(project(), [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 0, duration: 5 } },
    ], ctx).state;
    const existing = state.clips[0].id;

    expect(() =>
      applyActions(state, [
        {
          type: 'create_clip',
          params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 30, duration: 5, clipId: existing },
        },
      ], ctx),
    ).toThrow(/same id|corrupt/i);
  });
});
