import { z } from 'zod';
import type { MediaAnalysis, MediaAsset } from '@/types/editor';
import { defineAction, requireAsset, uuidLike, type AnyActionDef } from '../action-kit';

const assetSchema = z.object({
  id: uuidLike,
  projectId: uuidLike,
  kind: z.enum(['video', 'audio', 'image']),
  name: z.string().min(1).max(300),
  storagePath: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().min(0),
  duration: z.number().min(0),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  hasAudio: z.boolean(),
  sampleRate: z.number().nullable(),
  channels: z.number().nullable(),
  waveform: z.array(z.number()).nullable(),
  thumbnailUrl: z.string().nullable(),
  analysisStatus: z.enum(['pending', 'basic', 'transcribing', 'analyzed', 'failed']),
  createdAt: z.string(),
});

/**
 * Registers an uploaded asset in the editor state. Applied outside the undo
 * history — undoing an edit should never make an uploaded file vanish.
 */
const registerAsset = defineAction({
  type: 'register_asset',
  category: 'media',
  summary: 'Internal: attach an uploaded media asset to the project state.',
  schema: z.object({ asset: assetSchema }),
  apply: (state, params) => {
    const asset = params.asset as MediaAsset;
    const exists = state.assets.some((a) => a.id === asset.id);
    return {
      state: { ...state, assets: exists ? state.assets.map((a) => (a.id === asset.id ? asset : a)) : [...state.assets, asset] },
      description: `Imported "${asset.name}"`,
    };
  },
});

const updateAsset = defineAction({
  type: 'update_asset',
  category: 'media',
  summary: 'Internal: update analysis metadata on an asset.',
  schema: z.object({
    assetId: uuidLike,
    patch: z.record(z.string(), z.unknown()),
  }),
  apply: (state, params) => {
    const asset = requireAsset(state, params.assetId);
    const next = { ...asset, ...(params.patch as Partial<MediaAsset>) };
    return {
      state: { ...state, assets: state.assets.map((a) => (a.id === asset.id ? next : a)) },
      description: `Updated metadata for "${asset.name}"`,
    };
  },
});

const setAnalysis = defineAction({
  type: 'set_media_analysis',
  category: 'media',
  summary: 'Internal: store transcript and silence analysis for an asset.',
  schema: z.object({ assetId: uuidLike, analysis: z.unknown() }),
  apply: (state, params) => {
    const asset = requireAsset(state, params.assetId);
    return {
      state: { ...state, analysis: { ...state.analysis, [asset.id]: params.analysis as MediaAnalysis } },
      description: `Stored analysis for "${asset.name}"`,
    };
  },
});

const removeAsset = defineAction({
  type: 'remove_asset',
  category: 'media',
  summary:
    'Permanently remove a media asset from the project. Every clip using it is deleted too, and the file is deleted from storage. This cannot be undone.',
  destructive: true,
  schema: z.object({ assetId: uuidLike }),
  apply: (state, { assetId }) => {
    const asset = requireAsset(state, assetId);
    const clips = state.clips.filter((c) => !('assetId' in c && c.assetId === assetId));
    const removed = state.clips.length - clips.length;
    const analysis = { ...state.analysis };
    delete analysis[assetId];
    return {
      state: { ...state, clips, analysis, assets: state.assets.filter((a) => a.id !== assetId) },
      description: `Removed "${asset.name}" and ${removed} clip${removed === 1 ? '' : 's'} using it`,
    };
  },
});


export const mediaActions: AnyActionDef[] = [registerAsset, updateAsset, setAnalysis, removeAsset];
export const internalOnlyActionTypes = new Set(['register_asset', 'update_asset', 'set_media_analysis']);
