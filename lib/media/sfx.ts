'use client';

import { encodeWav } from './audio';

export type SfxCategory = 'whoosh' | 'impact' | 'ui' | 'comedy' | 'musical';

export interface SfxDefinition {
  id: string;
  name: string;
  category: SfxCategory;
  duration: number;
  /** One line the assistant reads when choosing a sound. */
  description: string;
}

/**
 * Every sound here is synthesised from oscillators and filtered noise at the
 * moment it is used. Nothing is downloaded, nothing is licensed, and the same
 * id always produces exactly the same waveform — so a project sounds identical
 * on every machine and in the exported file.
 */
export const SFX_LIBRARY: SfxDefinition[] = [
  { id: 'whoosh', name: 'Whoosh', category: 'whoosh', duration: 0.7, description: 'Air sweep for a text or cut' },
  { id: 'whoosh_deep', name: 'Deep whoosh', category: 'whoosh', duration: 1.1, description: 'Slower, heavier sweep' },
  { id: 'swish', name: 'Swish', category: 'whoosh', duration: 0.35, description: 'Fast flick, good under a jump cut' },
  { id: 'riser', name: 'Riser', category: 'whoosh', duration: 1.6, description: 'Builds tension into a reveal' },
  { id: 'impact', name: 'Impact', category: 'impact', duration: 1.2, description: 'Deep hit on a beat' },
  { id: 'thud', name: 'Thud', category: 'impact', duration: 0.5, description: 'Short low knock' },
  { id: 'boom', name: 'Boom', category: 'impact', duration: 1.8, description: 'Cinematic sub drop' },
  { id: 'pop', name: 'Pop', category: 'ui', duration: 0.18, description: 'Bubble pop as something appears' },
  { id: 'click', name: 'Click', category: 'ui', duration: 0.09, description: 'Tiny tick for a cut or beat' },
  { id: 'ding', name: 'Ding', category: 'ui', duration: 1.4, description: 'Bright bell for a correct answer' },
  { id: 'sparkle', name: 'Sparkle', category: 'ui', duration: 1.0, description: 'Little shimmer over a highlight' },
  { id: 'boing', name: 'Boing', category: 'comedy', duration: 0.6, description: 'Cartoon spring' },
  { id: 'record_scratch', name: 'Record scratch', category: 'comedy', duration: 0.7, description: 'Stop everything' },
  { id: 'error', name: 'Error buzz', category: 'comedy', duration: 0.45, description: 'Wrong answer' },
  { id: 'chime_up', name: 'Chime up', category: 'musical', duration: 1.3, description: 'Three notes rising' },
  { id: 'chime_down', name: 'Chime down', category: 'musical', duration: 1.3, description: 'Three notes falling' },
];

export const SFX_BY_ID = new Map(SFX_LIBRARY.map((sfx) => [sfx.id, sfx]));

export const SFX_CATEGORY_LABELS: Record<SfxCategory, string> = {
  whoosh: 'Whooshes',
  impact: 'Impacts',
  ui: 'Pops and clicks',
  comedy: 'Comedy',
  musical: 'Musical',
};

const SAMPLE_RATE = 44100;

/* -------------------------------------------------------------------------- */
/* Synthesis helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Deterministic noise, so the same id always renders the same bytes. */
function seededNoise(context: OfflineAudioContext, duration: number, seed: number): AudioBufferSourceNode {
  const length = Math.max(1, Math.ceil(duration * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let state = seed || 1;
  for (let i = 0; i < length; i += 1) {
    // xorshift: cheap, deterministic, and flat enough to sound like noise.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[i] = (state / 0x7fffffff) % 1;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}

function envelope(
  context: OfflineAudioContext,
  attack: number,
  decay: number,
  peak = 1,
): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, 0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, attack + decay);
  return gain;
}

function tone(
  context: OfflineAudioContext,
  type: OscillatorType,
  from: number,
  to: number,
  duration: number,
): OscillatorNode {
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, 0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), duration);
  return osc;
}

/* -------------------------------------------------------------------------- */
/* The sounds                                                                 */
/* -------------------------------------------------------------------------- */

function build(context: OfflineAudioContext, id: string, duration: number): void {
  const out = context.destination;

  switch (id) {
    case 'whoosh':
    case 'whoosh_deep':
    case 'swish': {
      const deep = id === 'whoosh_deep';
      const fast = id === 'swish';
      const noise = seededNoise(context, duration, 12345);
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = fast ? 1.6 : 1.1;
      // The sweep is what makes it read as movement rather than hiss.
      filter.frequency.setValueAtTime(deep ? 180 : 400, 0);
      filter.frequency.exponentialRampToValueAtTime(deep ? 1400 : fast ? 5000 : 3200, duration * 0.45);
      filter.frequency.exponentialRampToValueAtTime(deep ? 200 : 500, duration);
      const gain = envelope(context, duration * 0.3, duration * 0.7, fast ? 0.5 : 0.65);
      noise.connect(filter).connect(gain).connect(out);
      noise.start(0);
      break;
    }

    case 'riser': {
      const noise = seededNoise(context, duration, 4242);
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(200, 0);
      filter.frequency.exponentialRampToValueAtTime(6000, duration);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, 0);
      gain.gain.exponentialRampToValueAtTime(0.7, duration * 0.95);
      gain.gain.exponentialRampToValueAtTime(0.0001, duration);
      noise.connect(filter).connect(gain).connect(out);
      noise.start(0);

      // A rising tone under the noise gives it a pitch to follow.
      const osc = tone(context, 'sawtooth', 120, 900, duration);
      const oscGain = context.createGain();
      oscGain.gain.setValueAtTime(0.0001, 0);
      oscGain.gain.exponentialRampToValueAtTime(0.18, duration * 0.9);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, duration);
      osc.connect(oscGain).connect(out);
      osc.start(0);
      osc.stop(duration);
      break;
    }

    case 'impact':
    case 'thud':
    case 'boom': {
      const low = id === 'boom' ? 55 : id === 'thud' ? 90 : 70;
      const osc = tone(context, 'sine', low * 2.4, low * 0.6, duration * 0.6);
      const oscGain = envelope(context, 0.006, duration * 0.9, id === 'thud' ? 0.7 : 1);
      osc.connect(oscGain).connect(out);
      osc.start(0);
      osc.stop(duration);

      // A short noise transient is what gives the hit its edge.
      const noise = seededNoise(context, Math.min(0.12, duration), 777);
      const noiseFilter = context.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = id === 'boom' ? 800 : 2200;
      const noiseGain = envelope(context, 0.003, 0.1, 0.5);
      noise.connect(noiseFilter).connect(noiseGain).connect(out);
      noise.start(0);
      break;
    }

    case 'pop': {
      const osc = tone(context, 'sine', 900, 220, duration);
      const gain = envelope(context, 0.004, duration, 0.85);
      osc.connect(gain).connect(out);
      osc.start(0);
      osc.stop(duration);
      break;
    }

    case 'click': {
      const noise = seededNoise(context, duration, 99);
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2600;
      filter.Q.value = 2;
      const gain = envelope(context, 0.002, duration, 0.6);
      noise.connect(filter).connect(gain).connect(out);
      noise.start(0);
      break;
    }

    case 'ding':
    case 'sparkle': {
      const partials = id === 'ding' ? [1320, 2640, 3960] : [1800, 2400, 3200, 4800];
      partials.forEach((frequency, index) => {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        const gain = envelope(context, 0.005 + index * 0.02, duration * (1 - index * 0.15), 0.5 / (index + 1));
        osc.connect(gain).connect(out);
        osc.start(index * 0.03);
        osc.stop(duration);
      });
      break;
    }

    case 'boing': {
      const osc = context.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, 0);
      // The wobble is the spring.
      for (let i = 1; i <= 6; i += 1) {
        osc.frequency.exponentialRampToValueAtTime(i % 2 === 0 ? 620 : 180, (duration * i) / 6);
      }
      const gain = envelope(context, 0.01, duration, 0.7);
      osc.connect(gain).connect(out);
      osc.start(0);
      osc.stop(duration);
      break;
    }

    case 'record_scratch': {
      const noise = seededNoise(context, duration, 31337);
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 3;
      filter.frequency.setValueAtTime(1800, 0);
      filter.frequency.exponentialRampToValueAtTime(320, duration * 0.6);
      filter.frequency.exponentialRampToValueAtTime(120, duration);
      const gain = envelope(context, 0.02, duration, 0.75);
      noise.connect(filter).connect(gain).connect(out);
      noise.start(0);
      break;
    }

    case 'error': {
      [220, 180].forEach((frequency, index) => {
        const osc = context.createOscillator();
        osc.type = 'square';
        osc.frequency.value = frequency;
        const gain = envelope(context, 0.005, 0.18, 0.35);
        osc.connect(gain).connect(out);
        osc.start(index * 0.22);
        osc.stop(index * 0.22 + 0.2);
      });
      break;
    }

    case 'chime_up':
    case 'chime_down': {
      const notes = id === 'chime_up' ? [523.25, 659.25, 783.99] : [783.99, 659.25, 523.25];
      notes.forEach((frequency, index) => {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        const gain = context.createGain();
        const at = index * 0.18;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.5, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
        osc.connect(gain).connect(out);
        osc.start(at);
        osc.stop(Math.min(duration, at + 0.75));
      });
      break;
    }

    default:
      break;
  }
}

const cache = new Map<string, Blob>();

/** Renders one sound to a WAV blob, memoised for the session. */
export async function renderSfx(id: string): Promise<Blob> {
  const cached = cache.get(id);
  if (cached) return cached;

  const definition = SFX_BY_ID.get(id);
  if (!definition) throw new Error(`unknown_sound_effect:${id}`);

  const length = Math.ceil(definition.duration * SAMPLE_RATE);
  const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
  build(context, id, definition.duration);
  const rendered = await context.startRendering();

  const blob = encodeWav(rendered.getChannelData(0), SAMPLE_RATE);
  cache.set(id, blob);
  return blob;
}

export async function renderSfxFile(id: string): Promise<File> {
  const blob = await renderSfx(id);
  const definition = SFX_BY_ID.get(id);
  return new File([blob], `${definition?.name ?? id}.wav`, { type: 'audio/wav' });
}

/** The catalogue as the assistant sees it. */
export function sfxCatalogue(): { id: string; name: string; category: string; duration: number; description: string }[] {
  return SFX_LIBRARY.map((sfx) => ({
    id: sfx.id,
    name: sfx.name,
    category: sfx.category,
    duration: sfx.duration,
    description: sfx.description,
  }));
}
