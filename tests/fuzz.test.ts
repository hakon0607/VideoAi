/**
 * The engine has to survive being driven badly.
 *
 * A language model produces plausible-looking parameters, not correct ones, and
 * a user with a mouse produces sequences nobody thought about. This suite pours
 * thousands of semi-random but schema-valid actions through the registry and
 * asserts the timeline never reaches a state the rest of the app cannot render:
 * no NaN, no negative durations, no clip on a track that does not exist, no
 * overlap on a single track, no dangling asset reference.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { EditorState } from '@/types/editor';
import { ACTION_REGISTRY, applyActions } from '@/lib/editor/engine';
import { aiExposedActions } from '@/lib/editor/engine';
import { EditorError } from '@/lib/editor/errors';
import { clipEnd } from '@/lib/editor/time';
import { clipFitsTrack, emptyState } from '@/lib/editor/defaults';
import { testContext, TRACK_IDS, videoAsset } from './helpers';

/** Deterministic PRNG so a failure can be reproduced exactly. */
function rng(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state % 100000) / 100000;
  };
}

function baseState(): EditorState {
  const ctx = testContext();
  const state: EditorState = {
    ...emptyState('project-fuzz', 'timeline-fuzz', 'Fuzz', TRACK_IDS),
    assets: [videoAsset('a5501111-1111-4111-8111-111111111111', 40), { ...videoAsset('a5502222-2222-4222-8222-222222222222', 25), kind: 'audio', name: 'music.m4a' }],
  };
  return applyActions(
    state,
    [
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 0, duration: 10 } },
      { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111', start: 10, duration: 8 } },
      { type: 'create_clip', params: { trackId: TRACK_IDS[1], assetId: 'a5502222-2222-4222-8222-222222222222', start: 0, duration: 18 } },
      { type: 'add_text', params: { trackId: TRACK_IDS[2], text: 'hello', start: 1, duration: 4 } },
    ],
    ctx,
  ).state;
}

/** Everything the rest of the app assumes about a timeline. */
function checkInvariants(state: EditorState, label: string): void {
  const trackIds = new Set(state.tracks.map((t) => t.id));
  const assetIds = new Set(state.assets.map((a) => a.id));

  for (const track of state.tracks) {
    expect(Number.isFinite(track.index), `${label}: track index`).toBe(true);
    expect(track.height, `${label}: track height`).toBeGreaterThan(0);
  }

  const trackKinds = new Map(state.tracks.map((t) => [t.id, t.kind]));
  for (const clip of state.clips) {
    expect(trackIds.has(clip.trackId), `${label}: clip ${clip.id} on missing track`).toBe(true);
    expect(
      clipFitsTrack(clip.kind, trackKinds.get(clip.trackId)!),
      `${label}: ${clip.kind} clip ${clip.id} on a ${trackKinds.get(clip.trackId)} track`,
    ).toBe(true);
    expect(Number.isFinite(clip.start), `${label}: clip ${clip.id} start NaN`).toBe(true);
    expect(Number.isFinite(clip.duration), `${label}: clip ${clip.id} duration NaN`).toBe(true);
    expect(clip.start, `${label}: clip ${clip.id} negative start`).toBeGreaterThanOrEqual(0);
    expect(clip.duration, `${label}: clip ${clip.id} zero-length`).toBeGreaterThan(0);
    expect(Number.isFinite(clip.opacity)).toBe(true);
    if (clip.kind !== 'text') {
      expect(assetIds.has(clip.assetId), `${label}: clip ${clip.id} dangling asset`).toBe(true);
      expect(clip.speed, `${label}: clip ${clip.id} speed`).toBeGreaterThan(0);
      expect(Number.isFinite(clip.sourceIn)).toBe(true);
      expect(clip.sourceIn).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(clip.volume)).toBe(true);
    }
    for (const keyframe of clip.keyframes) {
      expect(Number.isFinite(keyframe.time), `${label}: keyframe time`).toBe(true);
      expect(Number.isFinite(keyframe.value), `${label}: keyframe value`).toBe(true);
    }
    for (const effect of clip.effects) {
      for (const [key, value] of Object.entries(effect.params)) {
        expect(Number.isFinite(value), `${label}: effect ${effect.type}.${key}`).toBe(true);
      }
    }
  }

  // One track never shows two clips at once.
  for (const track of state.tracks) {
    const onTrack = state.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    for (let i = 1; i < onTrack.length; i += 1) {
      expect(
        onTrack[i].start,
        `${label}: overlap on ${track.name} between ${JSON.stringify({ id: onTrack[i - 1].id, kind: onTrack[i - 1].kind, start: onTrack[i - 1].start, dur: onTrack[i - 1].duration })} and ${JSON.stringify({ id: onTrack[i].id, kind: onTrack[i].kind, start: onTrack[i].start, dur: onTrack[i].duration })}`,
      ).toBeGreaterThanOrEqual(clipEnd(onTrack[i - 1]) - 0.0011);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Parameter generation                                                       */
/* -------------------------------------------------------------------------- */

interface Pools {
  clipIds: string[];
  trackIds: string[];
  assetIds: string[];
  effectIds: { clipId: string; effectId: string }[];
  keyframeIds: { clipId: string; keyframeId: string }[];
  markerIds: string[];
  folderIds: string[];
}

function poolsFrom(state: EditorState): Pools {
  return {
    clipIds: state.clips.map((c) => c.id),
    trackIds: state.tracks.map((t) => t.id),
    assetIds: state.assets.map((a) => a.id),
    effectIds: state.clips.flatMap((c) => c.effects.map((e) => ({ clipId: c.id, effectId: e.id }))),
    keyframeIds: state.clips.flatMap((c) => c.keyframes.map((k) => ({ clipId: c.id, keyframeId: k.id }))),
    markerIds: state.markers.map((m) => m.id),
    folderIds: state.folders.map((f) => f.id),
  };
}

/**
 * Builds a value for one Zod schema node. Ids come from the live project, so
 * most actions are applicable rather than bouncing off "not found".
 */
function sample(schema: z.ZodType, key: string, pools: Pools, random: () => number): unknown {
  const def = (schema as unknown as { def: { type: string; [k: string]: unknown } }).def;
  const type = def?.type;

  switch (type) {
    case 'optional':
    case 'nullable':
      // Exercise the "absent" branch about a third of the time.
      return random() < 0.35 ? undefined : sample(def.innerType as z.ZodType, key, pools, random);
    case 'default':
      return random() < 0.4 ? undefined : sample(def.innerType as z.ZodType, key, pools, random);
    case 'pipe':
      return sample(def.in as z.ZodType, key, pools, random);
    case 'enum': {
      const values = Object.values((def as unknown as { entries: Record<string, string> }).entries);
      return values[Math.floor(random() * values.length)];
    }
    case 'literal':
      return (def as unknown as { values: unknown[] }).values[0];
    case 'boolean':
      return random() < 0.5;
    case 'number': {
      const checks = (def as unknown as { checks?: { _zod?: { def?: { check?: string; value?: number } } }[] }).checks ?? [];
      let min = -50;
      let max = 50;
      for (const check of checks) {
        const inner = check?._zod?.def;
        if (inner?.check === 'greater_than' && typeof inner.value === 'number') min = inner.value;
        if (inner?.check === 'less_than' && typeof inner.value === 'number') max = inner.value;
      }
      if (!Number.isFinite(min)) min = -50;
      if (!Number.isFinite(max)) max = 50;
      const value = min + random() * (max - min);
      return Math.round(value * 1000) / 1000;
    }
    case 'string': {
      if (/id$/i.test(key)) {
        if (/clip/i.test(key)) return pools.clipIds[Math.floor(random() * pools.clipIds.length)];
        if (/track/i.test(key)) return pools.trackIds[Math.floor(random() * pools.trackIds.length)];
        if (/asset/i.test(key)) return pools.assetIds[Math.floor(random() * pools.assetIds.length)];
        if (/marker/i.test(key)) return pools.markerIds[Math.floor(random() * pools.markerIds.length)];
        if (/folder/i.test(key)) return pools.folderIds[Math.floor(random() * pools.folderIds.length)];
        return undefined;
      }
      if (/color/i.test(key)) return '#7f3fbf';
      return ['hello', 'æøå', '  spaced  ', '🔥', 'a'.repeat(40)][Math.floor(random() * 5)];
    }
    case 'array': {
      const element = def.element as z.ZodType;
      const count = 1 + Math.floor(random() * 3);
      const items = Array.from({ length: count }, () => sample(element, key, pools, random));
      return items.filter((item) => item !== undefined);
    }
    case 'object': {
      const shape = (def as unknown as { shape: Record<string, z.ZodType> }).shape;
      const out: Record<string, unknown> = {};
      for (const [field, child] of Object.entries(shape)) {
        const value = sample(child, field, pools, random);
        if (value !== undefined) out[field] = value;
      }
      return out;
    }
    case 'record':
      return { amount: Math.round(random() * 2000) / 1000 };
    default:
      return undefined;
  }
}

describe('engine fuzz', () => {
  it('never produces an un-renderable timeline', { timeout: 60_000 }, () => {
    const types = aiExposedActions().map((a) => a.type);
    let crashes = 0;
    let applied = 0;

    for (let seed = 1; seed <= 900; seed += 1) {
      const random = rng(seed * 7919);
      let state = baseState();

      for (let step = 0; step < 40; step += 1) {
        const type = types[Math.floor(random() * types.length)];
        const def = ACTION_REGISTRY.get(type)!;
        const pools = poolsFrom(state);
        const params = sample(def.schema, 'root', pools, random) as Record<string, unknown>;
        if (!params || typeof params !== 'object') continue;

        try {
          const result = applyActions(state, [{ type, params }], testContext());
          state = result.state;
          applied += 1;
        } catch (error) {
          // A structured refusal is the correct outcome for nonsense input.
          if (error instanceof EditorError) continue;
          if (error instanceof z.ZodError) continue;
          crashes += 1;
          throw new Error(`seed ${seed} step ${step} ${type} threw ${String(error)}\n${JSON.stringify(params)}`);
        }
        checkInvariants(state, `seed ${seed} step ${step} after ${type}`);
      }
    }

    expect(crashes).toBe(0);
    // If almost nothing applied, the generator is broken rather than the engine.
    expect(applied).toBeGreaterThan(7000);
  });
});
