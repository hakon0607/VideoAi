import { describe, expect, it } from 'vitest';
import { applyActions } from '@/lib/editor/engine';
import { canRedo, canUndo, emptyHistory, pushEntry, redo, undo } from '@/lib/editor/history';
import { timelineDuration } from '@/lib/editor/selectors';
import type { HistoryEntry } from '@/lib/editor/history';
import { stateWithVideo, testContext, TRACK_IDS } from './helpers';

function entry(label: string, before: ReturnType<typeof stateWithVideo>, after: ReturnType<typeof stateWithVideo>): HistoryEntry {
  return {
    id: label,
    label,
    source: 'user',
    actions: [],
    descriptions: [],
    before,
    after,
    at: new Date().toISOString(),
  };
}

describe('history', () => {
  it('undoes and redoes a transaction as one step', () => {
    const base = stateWithVideo(20);
    const ctx = testContext();
    const after = applyActions(base, [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111' } }], ctx).state;

    let history = pushEntry(emptyHistory(), entry('add', base, after));
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    const undone = undo(history);
    expect(undone).not.toBeNull();
    expect(undone?.entry.before.clips).toHaveLength(0);
    history = undone!.history;
    expect(canRedo(history)).toBe(true);

    const redone = redo(history);
    expect(redone?.entry.after.clips).toHaveLength(1);
  });

  it('drops the redo stack when new work happens after an undo', () => {
    const base = stateWithVideo(20);
    const after = { ...base, name: 'changed' };
    let history = pushEntry(emptyHistory(), entry('a', base, after));
    history = undo(history)!.history;
    expect(canRedo(history)).toBe(true);
    history = pushEntry(history, entry('b', base, after));
    expect(canRedo(history)).toBe(false);
  });

  it('reverses a twelve-step AI batch with a single undo', () => {
    const ctx = testContext();
    const base = applyActions(
      stateWithVideo(120),
      [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111' } }],
      ctx,
    ).state;
    const clipId = base.clips[0].id;

    // Exactly the kind of thing "make it more energetic" produces.
    const result = applyActions(
      base,
      [
        { type: 'remove_ranges', params: { ranges: [{ start: 10, end: 12 }, { start: 30, end: 33 }], ripple: true } },
        { type: 'set_clip_speed', params: { clipId, speed: 1.08 } },
        { type: 'add_effect', params: { clipId, type: 'saturation', params: { amount: 1.25 } } },
        { type: 'add_effect', params: { clipId, type: 'contrast', params: { amount: 1.12 } } },
        { type: 'animate_property', params: { clipId, property: 'scale', from: 1, to: 1.06, startTime: 0, endTime: 4 } },
        { type: 'add_transition', params: { clipId, position: 'in', type: 'fade', duration: 0.4 } },
        { type: 'set_aspect_ratio', params: { aspectRatio: '9:16' } },
        { type: 'create_track', params: { kind: 'text' } },
        { type: 'set_background_color', params: { color: '#101010' } },
        { type: 'set_fps', params: { fps: 30 } },
        { type: 'set_clip_volume', params: { clipId, volume: 1.15 } },
        { type: 'set_audio_fade', params: { clipId, fadeIn: 0.3, fadeOut: 0.5 } },
      ],
      ctx,
    );

    expect(result.applied).toHaveLength(12);
    const history = pushEntry(emptyHistory(), entry('ai', base, result.state));
    const undone = undo(history)!;

    // One undo restores everything, including settings and the new track.
    expect(undone.entry.before.settings.aspectRatio).toBe('16:9');
    expect(undone.entry.before.tracks).toHaveLength(3);
    expect(undone.entry.before.clips[0].effects).toHaveLength(0);
    expect(timelineDuration(undone.entry.before)).toBeCloseTo(120, 1);
  });

  it('shares structure between snapshots so history stays cheap', () => {
    const ctx = testContext();
    const base = applyActions(
      stateWithVideo(30),
      [
        { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 0, duration: 10 } },
        { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 10, duration: 10 } },
      ],
      ctx,
    ).state;
    const after = applyActions(base, [{ type: 'set_clip_opacity', params: { clipId: base.clips[0].id, opacity: 0.5 } }], ctx).state;

    // The untouched clip is the very same object in both snapshots.
    expect(after.clips[1]).toBe(base.clips[1]);
    expect(after.tracks).toBe(base.tracks);
    expect(after.clips[0]).not.toBe(base.clips[0]);
  });
});
