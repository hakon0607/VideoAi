'use client';

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import type { SilenceSpan } from '@/types/editor';

export interface AudioAnalysis {
  /** ~1000 normalised peaks, enough to draw a waveform at any zoom. */
  waveform: number[];
  silences: SilenceSpan[];
  loudnessDb: number | null;
}

export interface SilenceOptions {
  /** Anything quieter than this (relative to peak) counts as silence. */
  thresholdDb: number;
  /** Shorter quiet stretches are ignored — they are just natural rhythm. */
  minDurationSeconds: number;
  /** Kept at each end of a cut so speech is never clipped. */
  paddingSeconds: number;
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
  thresholdDb: -38,
  minDurationSeconds: 0.45,
  paddingSeconds: 0.08,
};

const WAVEFORM_BUCKETS = 1200;
const WINDOW_SECONDS = 0.02;

/**
 * Streams the decoded audio once and derives everything cheap from it:
 * a waveform for the timeline, RMS windows, and the silence spans the AI needs
 * to answer "remove all the pauses". No AI call, no cost, no network.
 */
export async function analyzeAudio(
  file: File,
  duration: number,
  options: SilenceOptions = DEFAULT_SILENCE_OPTIONS,
  onProgress?: (fraction: number) => void,
): Promise<AudioAnalysis | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;

    const sink = new AudioBufferSink(track);
    const totalDuration = duration > 0 ? duration : await input.computeDuration();
    const bucketSeconds = totalDuration / WAVEFORM_BUCKETS;

    const waveform = new Float32Array(WAVEFORM_BUCKETS);
    const windows: { time: number; rms: number }[] = [];
    let peak = 0;
    let sumSquares = 0;
    let sampleCount = 0;

    for await (const { buffer, timestamp } of sink.buffers()) {
      const channels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const windowSize = Math.max(1, Math.round(WINDOW_SECONDS * sampleRate));
      const data: Float32Array[] = [];
      for (let c = 0; c < channels; c += 1) data.push(buffer.getChannelData(c));

      let windowSum = 0;
      let windowSamples = 0;
      let windowStart = timestamp;

      for (let i = 0; i < buffer.length; i += 1) {
        let value = 0;
        for (let c = 0; c < channels; c += 1) value += data[c][i];
        value /= channels;

        const magnitude = Math.abs(value);
        if (magnitude > peak) peak = magnitude;
        sumSquares += value * value;
        sampleCount += 1;

        const time = timestamp + i / sampleRate;
        const bucket = Math.min(WAVEFORM_BUCKETS - 1, Math.floor(time / Math.max(1e-6, bucketSeconds)));
        if (magnitude > waveform[bucket]) waveform[bucket] = magnitude;

        windowSum += value * value;
        windowSamples += 1;
        if (windowSamples >= windowSize) {
          windows.push({ time: windowStart, rms: Math.sqrt(windowSum / windowSamples) });
          windowSum = 0;
          windowSamples = 0;
          windowStart = time;
        }
      }
      if (windowSamples > 0) windows.push({ time: windowStart, rms: Math.sqrt(windowSum / windowSamples) });
      onProgress?.(Math.min(1, timestamp / Math.max(0.001, totalDuration)));
    }

    if (sampleCount === 0) return null;

    // Normalise the waveform to the loudest point so quiet recordings still
    // draw something visible.
    const normaliser = peak > 0 ? 1 / peak : 1;
    const normalisedWaveform = Array.from(waveform, (v) => Math.min(1, v * normaliser));

    const rmsOverall = Math.sqrt(sumSquares / sampleCount);
    const loudnessDb = rmsOverall > 0 ? 20 * Math.log10(rmsOverall) : null;

    const silences = detectSilences(windows, peak, totalDuration, options);
    onProgress?.(1);
    return { waveform: normalisedWaveform, silences, loudnessDb };
  } finally {
    input.dispose();
  }
}

/** Groups quiet windows into spans, with padding so speech is never clipped. */
export function detectSilences(
  windows: { time: number; rms: number }[],
  peak: number,
  duration: number,
  options: SilenceOptions,
): SilenceSpan[] {
  if (windows.length === 0 || peak <= 0) return [];
  const threshold = peak * Math.pow(10, options.thresholdDb / 20);

  const spans: SilenceSpan[] = [];
  let start: number | null = null;
  let previousTime = 0;

  for (const window of windows) {
    const quiet = window.rms < threshold;
    if (quiet && start === null) start = window.time;
    if (!quiet && start !== null) {
      pushSpan(spans, start, window.time, options, duration);
      start = null;
    }
    previousTime = window.time;
  }
  if (start !== null) pushSpan(spans, start, Math.max(previousTime, duration), options, duration);

  return spans;
}

function pushSpan(
  spans: SilenceSpan[],
  rawStart: number,
  rawEnd: number,
  options: SilenceOptions,
  duration: number,
): void {
  const start = Math.max(0, rawStart + options.paddingSeconds);
  const end = Math.min(duration, rawEnd - options.paddingSeconds);
  if (end - start >= options.minDurationSeconds) {
    spans.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
  }
}

/* -------------------------------------------------------------------------- */
/* WAV extraction for transcription                                           */
/* -------------------------------------------------------------------------- */

export interface AudioChunk {
  blob: Blob;
  /** Offset of this chunk inside the source, in seconds. */
  offset: number;
  duration: number;
}

const TRANSCRIBE_SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 480;

/**
 * Yields 16 kHz mono WAV chunks. Speech models only need mono 16 kHz, so this
 * is roughly 30 KB/s — a two-hour recording still fits comfortably under the
 * upload limits, and long files are split so nothing is ever truncated.
 */
export async function* extractWavChunks(
  file: File,
  onProgress?: (fraction: number) => void,
): AsyncGenerator<AudioChunk> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return;
    const duration = await input.computeDuration();
    const sink = new AudioBufferSink(track);

    let chunkStart = 0;
    let samples: number[] = [];
    // Fractional read position, carried across buffers so the resampled stream
    // has no gap or duplicated sample at the seams.
    let position = 0;

    const flush = (end: number): AudioChunk | null => {
      if (samples.length === 0) return null;
      const chunk: AudioChunk = {
        blob: encodeWav(Float32Array.from(samples), TRANSCRIBE_SAMPLE_RATE),
        offset: chunkStart,
        duration: end - chunkStart,
      };
      samples = [];
      chunkStart = end;
      return chunk;
    };

    for await (const { buffer, timestamp } of sink.buffers()) {
      const channels = buffer.numberOfChannels;
      const ratio = buffer.sampleRate / TRANSCRIBE_SAMPLE_RATE;
      const data: Float32Array[] = [];
      for (let c = 0; c < channels; c += 1) data.push(buffer.getChannelData(c));

      while (position < buffer.length) {
        const index = Math.floor(position);
        let value = 0;
        for (let c = 0; c < channels; c += 1) value += data[c][index] ?? 0;
        samples.push(value / channels);
        position += ratio;
      }
      position -= buffer.length;

      const elapsed = timestamp + buffer.duration;
      onProgress?.(Math.min(1, elapsed / Math.max(0.001, duration)));
      if (elapsed - chunkStart >= CHUNK_SECONDS) {
        const chunk = flush(elapsed);
        if (chunk) yield chunk;
      }
    }

    const final = flush(duration);
    if (final) yield final;
  } finally {
    input.dispose();
  }
}

/** Minimal 16-bit PCM WAV writer. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
