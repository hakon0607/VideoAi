'use client';

import { encodeWav } from './audio';

export type MusicMood = 'upbeat' | 'calm' | 'dramatic' | 'playful' | 'lofi';

export interface MusicBed {
  id: string;
  name: string;
  mood: MusicMood;
  /** Beats per minute. */
  bpm: number;
  /** Length of one loop in seconds. */
  duration: number;
  description: string;
}

/**
 * Music beds, synthesised in the browser.
 *
 * Licensing a music library is either expensive or legally awkward — most free
 * catalogues explicitly forbid re-hosting their files inside another app. These
 * are generated from oscillators and filtered noise instead: they cost nothing,
 * they cannot be taken away, they are identical on every machine, and they can
 * be used commercially without crediting anyone.
 *
 * They will not win a Grammy. They are what you put under a thirty-second
 * cooking video so it does not feel silent.
 */
export const MUSIC_LIBRARY: MusicBed[] = [
  { id: 'upbeat_pop', name: 'Upbeat pop', mood: 'upbeat', bpm: 120, duration: 16, description: 'Bright four-on-the-floor bed for a fast cut' },
  { id: 'energy_run', name: 'Energy', mood: 'upbeat', bpm: 128, duration: 16, description: 'Driving pulse for a montage' },
  { id: 'calm_piano', name: 'Calm keys', mood: 'calm', bpm: 80, duration: 16, description: 'Soft chords under a voiceover' },
  { id: 'ambient_pad', name: 'Ambient pad', mood: 'calm', bpm: 70, duration: 16, description: 'Slow wash, almost no rhythm' },
  { id: 'dramatic_build', name: 'Build', mood: 'dramatic', bpm: 90, duration: 16, description: 'Rising tension into a reveal' },
  { id: 'dark_pulse', name: 'Dark pulse', mood: 'dramatic', bpm: 100, duration: 16, description: 'Low heartbeat under something serious' },
  { id: 'playful_marimba', name: 'Playful', mood: 'playful', bpm: 110, duration: 16, description: 'Bouncy marimba for something light' },
  { id: 'quirky_pluck', name: 'Quirky', mood: 'playful', bpm: 105, duration: 16, description: 'Plucked notes with a wink' },
  { id: 'lofi_chill', name: 'Lo-fi chill', mood: 'lofi', bpm: 85, duration: 16, description: 'Warm, slightly detuned, hazy' },
  { id: 'lofi_night', name: 'Lo-fi night', mood: 'lofi', bpm: 75, duration: 16, description: 'Quieter, later, sleepier' },
];

export const MUSIC_BY_ID = new Map(MUSIC_LIBRARY.map((bed) => [bed.id, bed]));

const SAMPLE_RATE = 44100;

/* -------------------------------------------------------------------------- */
/* Note helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Semitones above A4, as frequency. */
function note(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/** Scale degrees for the moods, as semitone offsets from the root. */
const SCALES: Record<MusicMood, number[]> = {
  upbeat: [0, 2, 4, 7, 9],
  playful: [0, 2, 4, 7, 9],
  calm: [0, 2, 3, 5, 7, 10],
  lofi: [0, 3, 5, 7, 10],
  dramatic: [0, 2, 3, 7, 8],
};

/** Four-chord progressions, as semitone roots. */
const PROGRESSIONS: Record<MusicMood, number[]> = {
  upbeat: [0, 7, 9, 5],
  playful: [0, 5, 7, 5],
  calm: [0, 5, 3, 7],
  lofi: [0, 3, 8, 5],
  dramatic: [0, -4, 3, -2],
};

function envelope(
  context: OfflineAudioContext,
  at: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  gain.gain.setValueAtTime(Math.max(0.0002, peak), at + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  return gain;
}

function tone(
  context: OfflineAudioContext,
  destination: AudioNode,
  type: OscillatorType,
  frequency: number,
  at: number,
  length: number,
  peak: number,
  detune = 0,
): void {
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  osc.detune.setValueAtTime(detune, at);
  const gain = envelope(context, at, Math.min(0.02, length * 0.2), length * 0.3, length * 0.5, peak);
  osc.connect(gain).connect(destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

/** Deterministic noise, so a bed sounds the same everywhere. */
function noiseBuffer(context: OfflineAudioContext, length: number, seed: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.max(1, Math.ceil(length * SAMPLE_RATE)), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  let state = seed || 1;
  for (let i = 0; i < data.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[i] = (state / 0x7fffffff) % 1;
  }
  return buffer;
}

function hit(
  context: OfflineAudioContext,
  destination: AudioNode,
  at: number,
  kind: 'kick' | 'snare' | 'hat',
  peak: number,
): void {
  if (kind === 'kick') {
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    const gain = envelope(context, at, 0.004, 0.02, 0.14, peak);
    osc.connect(gain).connect(destination);
    osc.start(at);
    osc.stop(at + 0.3);
    return;
  }

  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context, kind === 'snare' ? 0.2 : 0.05, kind === 'snare' ? 9721 : 4409);
  const filter = context.createBiquadFilter();
  filter.type = kind === 'snare' ? 'bandpass' : 'highpass';
  filter.frequency.value = kind === 'snare' ? 1800 : 7000;
  const gain = envelope(context, at, 0.002, 0.01, kind === 'snare' ? 0.16 : 0.04, peak);
  source.connect(filter).connect(gain).connect(destination);
  source.start(at);
  source.stop(at + 0.3);
}

/* -------------------------------------------------------------------------- */
/* Arrangement                                                                */
/* -------------------------------------------------------------------------- */

function arrange(context: OfflineAudioContext, bed: MusicBed): void {
  const master = context.createGain();
  master.gain.value = 0.42;
  const warmth = context.createBiquadFilter();
  warmth.type = 'lowpass';
  warmth.frequency.value = bed.mood === 'lofi' ? 2600 : 12000;
  master.connect(warmth).connect(context.destination);

  const beat = 60 / bed.bpm;
  const bar = beat * 4;
  const bars = Math.max(1, Math.round(bed.duration / bar));
  const scale = SCALES[bed.mood];
  const progression = PROGRESSIONS[bed.mood];
  const drums = bed.mood !== 'calm';

  for (let barIndex = 0; barIndex < bars; barIndex += 1) {
    const at = barIndex * bar;
    const root = progression[barIndex % progression.length] - 12;

    // Bass on the root, one note per bar, two in the busier moods.
    tone(context, master, bed.mood === 'lofi' ? 'triangle' : 'sawtooth', note(root - 12), at, bar * 0.9, 0.28);
    if (bed.mood === 'upbeat' || bed.mood === 'playful') {
      tone(context, master, 'sawtooth', note(root - 12), at + bar / 2, bar * 0.4, 0.2);
    }

    // Chord: root, third and fifth of the scale, held across the bar.
    for (const degree of [0, 2, 4]) {
      const semitone = root + scale[degree % scale.length] + (degree >= scale.length ? 12 : 0);
      tone(
        context,
        master,
        bed.mood === 'dramatic' ? 'sawtooth' : 'triangle',
        note(semitone),
        at,
        bar * 0.95,
        bed.mood === 'calm' ? 0.16 : 0.11,
        bed.mood === 'lofi' ? -8 : 0,
      );
    }

    // Melody: one note per beat, walking the scale deterministically so the
    // same bed always plays the same tune.
    for (let step = 0; step < 4; step += 1) {
      if (bed.mood === 'calm' && step % 2 === 1) continue;
      const index = (barIndex * 3 + step * 2) % scale.length;
      const semitone = root + 12 + scale[index];
      tone(
        context,
        master,
        bed.mood === 'playful' ? 'square' : 'sine',
        note(semitone),
        at + step * beat,
        beat * (bed.mood === 'playful' ? 0.4 : 0.8),
        bed.mood === 'playful' ? 0.13 : 0.1,
      );
    }

    if (!drums) continue;
    for (let step = 0; step < 8; step += 1) {
      const when = at + step * (beat / 2);
      if (step % 4 === 0) hit(context, master, when, 'kick', 0.5);
      if (step % 4 === 2) hit(context, master, when, 'snare', 0.28);
      if (bed.mood !== 'dramatic') hit(context, master, when, 'hat', 0.12);
    }
  }
}

const cache = new Map<string, Blob>();

/** Renders one bed to a WAV blob, memoised for the session. */
export async function renderMusic(id: string): Promise<Blob> {
  const cached = cache.get(id);
  if (cached) return cached;

  const bed = MUSIC_BY_ID.get(id);
  if (!bed) throw new Error(`unknown_music_bed:${id}`);

  const context = new OfflineAudioContext(1, Math.ceil(bed.duration * SAMPLE_RATE), SAMPLE_RATE);
  arrange(context, bed);
  const rendered = await context.startRendering();

  const blob = encodeWav(rendered.getChannelData(0), SAMPLE_RATE);
  cache.set(id, blob);
  return blob;
}

export async function renderMusicFile(id: string): Promise<File> {
  const blob = await renderMusic(id);
  const bed = MUSIC_BY_ID.get(id);
  return new File([blob], `${bed?.name ?? id}.wav`, { type: 'audio/wav' });
}

/** The catalogue as the assistant sees it. */
export function musicCatalogue(): { id: string; name: string; mood: string; bpm: number; duration: number; description: string }[] {
  return MUSIC_LIBRARY.map((bed) => ({
    id: bed.id,
    name: bed.name,
    mood: bed.mood,
    bpm: bed.bpm,
    duration: bed.duration,
    description: bed.description,
  }));
}
