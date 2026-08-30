'use client';

import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from 'mediabunny';
import type { EditorState, MediaClip } from '@/types/editor';
import { isMediaClip } from '@/types/editor';
import { animatedValues } from '@/lib/editor/keyframes';
import { clipEnd } from '@/lib/editor/time';
import { getTrack } from '@/lib/editor/selectors';
import { buildCompressor, buildFilterChain, dbToGain, duckFactorAt } from './audio-graph';

/** Opens each asset once and hands out its audio sink on demand. */
export class AudioSourcePool {
  private inputs = new Map<string, Input>();
  private sinks = new Map<string, AudioBufferSink | null>();

  constructor(private urls: Record<string, string>) {}

  async getSink(assetId: string): Promise<AudioBufferSink | null> {
    if (this.sinks.has(assetId)) return this.sinks.get(assetId) ?? null;
    const url = this.urls[assetId];
    if (!url) {
      this.sinks.set(assetId, null);
      return null;
    }
    const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    this.inputs.set(assetId, input);
    const track = await input.getPrimaryAudioTrack();
    const sink = track ? new AudioBufferSink(track) : null;
    this.sinks.set(assetId, sink);
    return sink;
  }

  dispose(): void {
    for (const input of this.inputs.values()) input.dispose();
    this.inputs.clear();
    this.sinks.clear();
  }
}

/**
 * Pulls one range of an asset's audio into a single AudioBuffer.
 * Only the range the clip actually needs is decoded, so exporting a 20-second
 * cut of a one-hour recording does not decode the whole hour.
 */
async function fetchRange(
  context: BaseAudioContext,
  sink: AudioBufferSink,
  start: number,
  end: number,
): Promise<AudioBuffer | null> {
  const pieces: { buffer: AudioBuffer; timestamp: number }[] = [];
  for await (const item of sink.buffers(start, end)) {
    pieces.push({ buffer: item.buffer, timestamp: item.timestamp });
  }
  if (pieces.length === 0) return null;

  const sampleRate = pieces[0].buffer.sampleRate;
  const channels = Math.max(...pieces.map((p) => p.buffer.numberOfChannels));
  const length = Math.max(1, Math.ceil((end - start) * sampleRate));
  const output = context.createBuffer(channels, length, sampleRate);

  for (const piece of pieces) {
    const offset = Math.round((piece.timestamp - start) * sampleRate);
    for (let c = 0; c < channels; c += 1) {
      const source = piece.buffer.getChannelData(Math.min(c, piece.buffer.numberOfChannels - 1));
      const target = output.getChannelData(c);
      for (let i = 0; i < source.length; i += 1) {
        const index = offset + i;
        if (index >= 0 && index < length) target[index] = source[i];
      }
    }
  }
  return output;
}

function reverseBuffer(buffer: AudioBuffer): AudioBuffer {
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    buffer.getChannelData(c).reverse();
  }
  return buffer;
}

export interface AudioSegment {
  start: number;
  end: number;
}

/**
 * Renders one slice of the finished mix.
 *
 * The timeline is mixed in segments rather than all at once so memory stays
 * flat: a one-hour export never holds more than a minute of PCM at a time.
 */
export async function renderAudioSegment(
  state: EditorState,
  pool: AudioSourcePool,
  segment: AudioSegment,
  sampleRate: number,
  channels = 2,
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil((segment.end - segment.start) * sampleRate));
  const context = new OfflineAudioContext(channels, length, sampleRate);

  const clips = state.clips.filter((clip): clip is MediaClip => {
    if (!isMediaClip(clip) || clip.kind === 'image' || clip.muted) return false;
    const track = getTrack(state, clip.trackId);
    if (!track || track.muted) return false;
    return clipEnd(clip) > segment.start && clip.start < segment.end;
  });

  for (const clip of clips) {
    const sink = await pool.getSink(clip.assetId);
    if (!sink) continue;

    const track = getTrack(state, clip.trackId);
    const windowStart = Math.max(clip.start, segment.start);
    const windowEnd = Math.min(clipEnd(clip), segment.end);
    if (windowEnd <= windowStart) continue;

    // Which slice of the source feeds this slice of the timeline.
    const localStart = windowStart - clip.start;
    const localEnd = windowEnd - clip.start;
    const span = clip.duration * clip.speed;
    const sourceStart = clip.freeze
      ? clip.sourceIn
      : clip.reversed
        ? clip.sourceIn + span - localEnd * clip.speed
        : clip.sourceIn + localStart * clip.speed;
    const sourceEnd = clip.freeze ? clip.sourceIn : sourceStart + (localEnd - localStart) * clip.speed;
    if (clip.freeze) continue; // A frozen frame has no moving audio.

    const raw = await fetchRange(context, sink, Math.max(0, sourceStart), Math.max(0, sourceEnd));
    if (!raw) continue;

    const node = context.createBufferSource();
    node.buffer = clip.reversed ? reverseBuffer(raw) : raw;
    node.playbackRate.value = clip.speed;

    const gain = context.createGain();
    const trackGain = track?.volume ?? 1;
    const startAt = windowStart - segment.start;
    const endAt = windowEnd - segment.start;

    // Volume, keyframes, fades and ducking all become one gain envelope,
    // sampled often enough that an animated level is smooth and a duck ramps
    // rather than clicks.
    const steps = Math.max(2, Math.min(1200, Math.ceil((endAt - startAt) * 40)));
    gain.gain.setValueAtTime(0, 0);
    const staticGain = dbToGain(clip.audio.gainDb ?? 0);
    for (let i = 0; i <= steps; i += 1) {
      const t = startAt + ((endAt - startAt) * i) / steps;
      const timelineTime = t + segment.start;
      const local = timelineTime - clip.start;
      const values = animatedValues(clip, local);
      let value = values.volume * trackGain * staticGain;
      if (clip.fadeIn > 0 && local < clip.fadeIn) value *= local / clip.fadeIn;
      const remaining = clip.duration - local;
      if (clip.fadeOut > 0 && remaining < clip.fadeOut) value *= Math.max(0, remaining / clip.fadeOut);
      value *= duckFactorAt(state, clip, timelineTime);
      gain.gain.setValueAtTime(Math.max(0, Math.min(4, value)), Math.max(0, t));
    }

    // Filter chain and compressor sit between the source and the envelope, so
    // the level you set is the level after processing.
    const chain = buildFilterChain(context, clip.audio.filter ?? 'none');
    const compressor = buildCompressor(context, clip.audio.compression ?? 0);

    let head: AudioNode = node;
    if (chain) {
      head.connect(chain.input);
      head = chain.output;
    }
    if (compressor) {
      head.connect(compressor);
      head = compressor;
    }
    head.connect(gain).connect(context.destination);

    node.start(Math.max(0, startAt));
    node.stop(Math.max(0.0001, endAt));
  }

  return context.startRendering();
}

/** True when the timeline has anything audible at all. */
export function hasAudio(state: EditorState): boolean {
  return state.clips.some((clip) => {
    if (!isMediaClip(clip) || clip.kind === 'image' || clip.muted) return false;
    const track = getTrack(state, clip.trackId);
    return Boolean(track && !track.muted);
  });
}
