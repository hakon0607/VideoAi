/**
 * The music catalogue, as plain data.
 *
 * Kept apart from lib/media/music.ts because that module synthesises audio with
 * browser APIs; this one has to be readable from the server, where the AI tool
 * definitions are built.
 */
export interface MusicInfo {
  id: string;
  name: string;
  mood: string;
  bpm: number;
  duration: number;
  description: string;
}

export const MUSIC_LIBRARY_INFO: MusicInfo[] = [
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
