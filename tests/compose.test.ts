import { describe, expect, it } from 'vitest';
import { applyActions } from '@/lib/editor/engine';
import { clipRenderWindow, isOverlapTransition, visibleClips, wrapText } from '@/lib/render/compose';
import { evaluateKeyframes, animatedValues } from '@/lib/editor/keyframes';
import { resolveEffects } from '@/lib/render/effects';
import { stateWithVideo, testContext, TRACK_IDS } from './helpers';

function twoAdjacentClips() {
  const ctx = testContext();
  const state = applyActions(
    stateWithVideo(60),
    [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 0, duration: 10 } },
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 10, duration: 10 } },
    ],
    ctx,
  ).state;
  return { state, ctx };
}

describe('transitions', () => {
  it('extends the render window only for blending transitions', () => {
    const { state, ctx } = twoAdjacentClips();
    const [first, second] = state.clips;

    const crossfaded = applyActions(
      state,
      [
        {
          type: 'add_transition_between',
          params: { fromClipId: first.id, toClipId: second.id, type: 'crossfade', duration: 1 },
        },
      ],
      ctx,
    ).state;

    const a = crossfaded.clips[0];
    const b = crossfaded.clips[1];
    // The pair overlaps by the transition length, centred on the cut.
    expect(clipRenderWindow(a).end).toBeCloseTo(10.5);
    expect(clipRenderWindow(b).start).toBeCloseTo(9.5);
    expect(visibleClips(crossfaded, 10).length).toBe(2);
  });

  it('keeps a fade inside its own clip', () => {
    const { state, ctx } = twoAdjacentClips();
    const faded = applyActions(
      state,
      [{ type: 'add_transition', params: { clipId: state.clips[0].id, position: 'out', type: 'fade', duration: 1 } }],
      ctx,
    ).state;
    expect(clipRenderWindow(faded.clips[0]).end).toBeCloseTo(10);
    expect(isOverlapTransition('fade')).toBe(false);
    expect(isOverlapTransition('crossfade')).toBe(true);
  });

  it('never lets a transition exceed half the clip', () => {
    const ctx = testContext();
    const state = applyActions(
      stateWithVideo(60),
      [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 0, duration: 1 } }],
      ctx,
    ).state;
    const result = applyActions(
      state,
      [{ type: 'add_transition', params: { clipId: state.clips[0].id, position: 'in', type: 'crossfade', duration: 5 } }],
      ctx,
    ).state;
    expect(result.clips[0].transitionIn?.duration).toBeCloseTo(0.5);
  });
});

describe('visibility', () => {
  it('leaves audio out of the picture and respects hidden tracks', () => {
    const ctx = testContext();
    const state = applyActions(
      stateWithVideo(60),
      [
        { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 0, duration: 10 } },
        { type: 'add_text', params: { trackId: TRACK_IDS[2], text: 'Hi', start: 0, duration: 5 } },
      ],
      ctx,
    ).state;
    expect(visibleClips(state, 2)).toHaveLength(2);
    expect(visibleClips(state, 7)).toHaveLength(1);

    const hidden = applyActions(
      state,
      [{ type: 'set_track_properties', params: { trackId: TRACK_IDS[2], hidden: true } }],
      ctx,
    ).state;
    expect(visibleClips(hidden, 2)).toHaveLength(1);
  });

  it('draws lower tracks first', () => {
    const ctx = testContext();
    const state = applyActions(
      stateWithVideo(60),
      [
        { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 0, duration: 10 } },
        { type: 'add_text', params: { trackId: TRACK_IDS[2], text: 'On top', start: 0, duration: 10 } },
      ],
      ctx,
    ).state;
    const order = visibleClips(state, 1);
    expect(order[0].kind).toBe('video');
    expect(order[1].kind).toBe('text');
  });
});

describe('keyframes', () => {
  it('interpolates between two keyframes', () => {
    const frames = [
      { id: 'a', property: 'scale' as const, time: 0, value: 1, easing: 'linear' as const },
      { id: 'b', property: 'scale' as const, time: 2, value: 2, easing: 'linear' as const },
    ];
    expect(evaluateKeyframes(frames, 'scale', 0, 1)).toBe(1);
    expect(evaluateKeyframes(frames, 'scale', 1, 1)).toBeCloseTo(1.5);
    expect(evaluateKeyframes(frames, 'scale', 2, 1)).toBe(2);
    // Outside the range the nearest keyframe holds.
    expect(evaluateKeyframes(frames, 'scale', 5, 1)).toBe(2);
  });

  it('falls back to the static value when nothing is keyframed', () => {
    expect(evaluateKeyframes([], 'scale', 3, 0.75)).toBe(0.75);
  });

  it('feeds animated values into the compositor', () => {
    const ctx = testContext();
    const base = applyActions(
      stateWithVideo(60),
      [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 0, duration: 10 } }],
      ctx,
    ).state;
    const clipId = base.clips[0].id;
    const state = applyActions(
      base,
      [
        {
          type: 'animate_property',
          params: { clipId, property: 'scale', from: 1, to: 1.4, startTime: 0, endTime: 10, easing: 'linear' },
        },
      ],
      ctx,
    ).state;
    expect(animatedValues(state.clips[0], 0).scale).toBeCloseTo(1);
    expect(animatedValues(state.clips[0], 5).scale).toBeCloseTo(1.2);
    expect(animatedValues(state.clips[0], 10).scale).toBeCloseTo(1.4);
  });
});

describe('effects', () => {
  it('builds a canvas filter string and separates manual effects', () => {
    const ctx = testContext();
    const base = applyActions(
      stateWithVideo(60),
      [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 0, duration: 10 } }],
      ctx,
    ).state;
    const clipId = base.clips[0].id;
    const state = applyActions(
      base,
      [
        { type: 'add_effect', params: { clipId, type: 'saturation', params: { amount: 1.3 } } },
        { type: 'add_effect', params: { clipId, type: 'blur', params: { radius: 3 } } },
        { type: 'add_effect', params: { clipId, type: 'vignette', params: { amount: 0.4, softness: 0.6 } } },
        { type: 'add_effect', params: { clipId, type: 'sharpen', params: { amount: 0.5 } } },
      ],
      ctx,
    ).state;

    const resolved = resolveEffects(state.clips[0], 0);
    expect(resolved.filter).toContain('saturate(1.300)');
    expect(resolved.filter).toContain('blur(3.00px)');
    expect(resolved.vignette?.amount).toBeCloseTo(0.4);
    expect(resolved.sharpen).toBeCloseTo(0.5);
  });

  it('ignores disabled effects', () => {
    const ctx = testContext();
    const base = applyActions(
      stateWithVideo(60),
      [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 0, duration: 10 } }],
      ctx,
    ).state;
    const clipId = base.clips[0].id;
    const added = applyActions(base, [{ type: 'add_effect', params: { clipId, type: 'grayscale' } }], ctx).state;
    const effectId = added.clips[0].effects[0].id;
    const disabled = applyActions(
      added,
      [{ type: 'update_effect', params: { clipId, effectId, enabled: false } }],
      ctx,
    ).state;
    expect(resolveEffects(disabled.clips[0], 0).filter).toBe('none');
  });

  it('clamps out-of-range effect parameters instead of failing', () => {
    const ctx = testContext();
    const base = applyActions(
      stateWithVideo(60),
      [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1', start: 0, duration: 10 } }],
      ctx,
    ).state;
    const clipId = base.clips[0].id;
    const state = applyActions(
      base,
      [{ type: 'add_effect', params: { clipId, type: 'brightness', params: { amount: 99 } } }],
      ctx,
    ).state;
    expect(state.clips[0].effects[0].params.amount).toBe(4);
  });
});

describe('text layout', () => {
  it('wraps to the given width and keeps explicit newlines', () => {
    // A fake context that measures 10px per character.
    const ctx = {
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as unknown as CanvasRenderingContext2D;
    expect(wrapText(ctx, 'one two three four', 100)).toEqual(['one two', 'three four']);
    expect(wrapText(ctx, 'a\nb', 100)).toEqual(['a', 'b']);
  });
});
