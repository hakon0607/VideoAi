import type { EditorState, MediaAsset } from '@/types/editor';
import { emptyState } from '@/lib/editor/defaults';
import { createSequentialIdFactory } from '@/lib/editor/ids';
import type { ActionContext } from '@/lib/editor/action-kit';

// Each context gets its own prefix, so ids from two batches in the same test
// can never collide the way real uuids never collide.
let contextCounter = 0;

export function testContext(): ActionContext {
  contextCounter += 1;
  const prefix = (0xaaa0 + contextCounter).toString(16).slice(-4);
  return { newId: createSequentialIdFactory(prefix) };
}

export const TRACK_IDS: [string, string, string] = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

export function videoAsset(id: string, duration = 60): MediaAsset {
  return {
    id,
    projectId: 'p9001111-1111-4111-8111-111111111111',
    folderId: null,
    kind: 'video',
    name: 'interview.mp4',
    storagePath: `user/u1/projects/p1/media/${id}`,
    mimeType: 'video/mp4',
    sizeBytes: 1024,
    duration,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    sampleRate: 48000,
    channels: 2,
    waveform: null,
    thumbnailUrl: null,
    analysisStatus: 'basic',
    createdAt: new Date(0).toISOString(),
  };
}

export function stateWithVideo(duration = 60): EditorState {
  const state = emptyState('p9001111-1111-4111-8111-111111111111', 'timeline-1', 'Test project', TRACK_IDS);
  return { ...state, assets: [videoAsset('a5501111-1111-4111-8111-111111111111', duration)] };
}
