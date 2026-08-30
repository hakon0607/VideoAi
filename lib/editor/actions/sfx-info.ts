/**
 * The sound catalogue, as plain data.
 *
 * Kept apart from lib/media/sfx.ts because that module synthesises audio with
 * browser APIs; this one has to be readable from the server, where the AI tool
 * definitions are built.
 */
export interface SfxInfo {
  id: string;
  name: string;
  category: string;
  duration: number;
  description: string;
}

export const SFX_LIBRARY_INFO: SfxInfo[] = [
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
