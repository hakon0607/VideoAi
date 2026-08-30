'use client';

import { create } from 'zustand';
import type { EditorSelection, EditorState, MediaAnalysis, MediaAsset, UUID } from '@/types/editor';
import type { EditorAction } from './action-kit';
import { applyActions, applyActionsLenient } from './engine';
import { EditorError } from './errors';
import { newId } from './ids';
import {
  canRedo as canRedoHistory,
  canUndo as canUndoHistory,
  emptyHistory,
  pushEntry,
  redo as redoHistory,
  undo as undoHistory,
  type ChangeSource,
  type History,
  type HistoryEntry,
} from './history';
import { timelineDuration } from './selectors';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface DispatchOptions {
  label: string;
  source?: ChangeSource;
  /** Skip the history stack. Used for imports, which undo must never remove. */
  silent?: boolean;
  /** Apply what fits and report the rest instead of failing the whole batch. */
  lenient?: boolean;
  aiMessageId?: string;
}

export interface DispatchResult {
  ok: boolean;
  error?: EditorError;
  entryId?: string;
  applied: { action: EditorAction; description: string }[];
  failures?: { action: EditorAction; error: EditorError }[];
}

interface EditorStore {
  state: EditorState;
  history: History;
  selection: EditorSelection;
  playhead: number;
  playing: boolean;
  /** Timeline zoom, in pixels per second. */
  pixelsPerSecond: number;
  /** Preview playback speed. A viewing convenience; never part of the project. */
  previewRate: number;
  /** Smallest useful zoom, published by the timeline from its own width. */
  zoomFloor: number;
  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: string | null;
  aiBusy: boolean;
  ready: boolean;

  load: (state: EditorState) => void;
  dispatch: (actions: EditorAction[], options: DispatchOptions) => DispatchResult;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
  canUndo: () => boolean;
  canRedo: () => boolean;

  select: (clipIds: UUID[], trackId?: UUID | null) => void;
  toggleSelect: (clipId: UUID) => void;
  clearSelection: () => void;

  setPlayhead: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setPixelsPerSecond: (value: number) => void;
  setZoomFloor: (value: number) => void;
  setPreviewRate: (value: number) => void;
  setAiBusy: (busy: boolean) => void;

  registerAsset: (asset: MediaAsset) => void;
  patchAsset: (assetId: UUID, patch: Partial<MediaAsset>) => void;
  setAnalysis: (assetId: UUID, analysis: MediaAnalysis) => void;

  markSaving: () => void;
  markSaved: () => void;
  markSaveError: (message: string) => void;
}

const EMPTY_STATE: EditorState = {
  projectId: '',
  timelineId: '',
  name: '',
  settings: {
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    backgroundColor: '#000000',
    sampleRate: 48000,
  },
  tracks: [],
  clips: [],
  assets: [],
  analysis: {},
  markers: [],
  folders: [],
  revision: 0,
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  state: EMPTY_STATE,
  history: emptyHistory(),
  selection: { clipIds: [], trackId: null },
  playhead: 0,
  playing: false,
  pixelsPerSecond: 60,
  previewRate: 1,
  zoomFloor: 0.05,
  saveStatus: 'idle',
  saveError: null,
  lastSavedAt: null,
  aiBusy: false,
  ready: false,

  load: (state) =>
    set({
      state,
      history: emptyHistory(),
      selection: { clipIds: [], trackId: state.tracks[0]?.id ?? null },
      playhead: 0,
      playing: false,
      saveStatus: 'idle',
      saveError: null,
      ready: true,
    }),

  /**
   * The one way anything changes the project. The UI and the AI both land here,
   * so a manual trim and an AI trim are literally the same code path — and a
   * whole AI request becomes exactly one entry on the undo stack.
   */
  dispatch: (actions, options) => {
    if (actions.length === 0) return { ok: true, applied: [] };
    const before = get().state;
    try {
      const result = options.lenient
        ? applyActionsLenient(before, actions, { newId })
        : { ...applyActions(before, actions, { newId }), failures: [] as DispatchResult['failures'] };
      const failures = result.failures ?? [];

      if (result.applied.length === 0) {
        const first = failures[0]?.error;
        return { ok: false, error: first, applied: [], failures };
      }

      const entry: HistoryEntry = {
        id: newId(),
        label: options.label,
        source: options.source ?? 'user',
        actions: result.applied.map((a) => a.action),
        descriptions: result.applied.map((a) => a.description),
        before,
        after: result.state,
        at: new Date().toISOString(),
      };

      set((store) => ({
        state: result.state,
        history: options.silent ? store.history : pushEntry(store.history, entry),
        saveStatus: 'dirty',
        // Drop selections that point at clips the batch removed.
        selection: {
          ...store.selection,
          clipIds: store.selection.clipIds.filter((id) => result.state.clips.some((c) => c.id === id)),
        },
      }));

      return { ok: true, entryId: entry.id, applied: result.applied, failures };
    } catch (error) {
      const editorError =
        error instanceof EditorError
          ? error
          : new EditorError('invalid_parameters', error instanceof Error ? error.message : String(error));
      return { ok: false, error: editorError, applied: [] };
    }
  },

  undo: () => {
    const result = undoHistory(get().history);
    if (!result) return null;
    set((store) => ({
      history: result.history,
      state: { ...result.entry.before, revision: store.state.revision + 1 },
      saveStatus: 'dirty',
      selection: { ...store.selection, clipIds: [] },
    }));
    return result.entry;
  },

  redo: () => {
    const result = redoHistory(get().history);
    if (!result) return null;
    set((store) => ({
      history: result.history,
      state: { ...result.entry.after, revision: store.state.revision + 1 },
      saveStatus: 'dirty',
      selection: { ...store.selection, clipIds: [] },
    }));
    return result.entry;
  },

  canUndo: () => canUndoHistory(get().history),
  canRedo: () => canRedoHistory(get().history),

  select: (clipIds, trackId) =>
    set((store) => ({ selection: { clipIds, trackId: trackId ?? store.selection.trackId } })),

  toggleSelect: (clipId) =>
    set((store) => ({
      selection: {
        ...store.selection,
        clipIds: store.selection.clipIds.includes(clipId)
          ? store.selection.clipIds.filter((id) => id !== clipId)
          : [...store.selection.clipIds, clipId],
      },
    })),

  clearSelection: () => set((store) => ({ selection: { ...store.selection, clipIds: [] } })),

  setPlayhead: (time) => {
    const duration = timelineDuration(get().state);
    set({ playhead: Math.max(0, Math.min(time, Math.max(duration, 0.001))) });
  },
  setPlaying: (playing) => set({ playing }),
  // The lower bound has to be small enough that a two-hour timeline can be
  // fitted on screen — the timeline publishes the exact floor for its own
  // width, so zooming out never produces an empty ruler. The upper bound is
  // frame-level detail.
  setPixelsPerSecond: (value) =>
    set((store) => ({ pixelsPerSecond: Math.max(store.zoomFloor, Math.min(600, value)) })),
  setZoomFloor: (value) =>
    set((store) => {
      const zoomFloor = Math.max(0.02, Math.min(60, value));
      return { zoomFloor, pixelsPerSecond: Math.max(zoomFloor, store.pixelsPerSecond) };
    }),
  setPreviewRate: (value) => set({ previewRate: Math.max(0.1, Math.min(4, value)) }),
  setAiBusy: (aiBusy) => set({ aiBusy }),

  registerAsset: (asset) =>
    set((store) => ({
      state: {
        ...store.state,
        assets: store.state.assets.some((a) => a.id === asset.id)
          ? store.state.assets.map((a) => (a.id === asset.id ? asset : a))
          : [...store.state.assets, asset],
      },
    })),

  patchAsset: (assetId, patch) =>
    set((store) => ({
      state: {
        ...store.state,
        assets: store.state.assets.map((a) => (a.id === assetId ? { ...a, ...patch } : a)),
      },
    })),

  setAnalysis: (assetId, analysis) =>
    set((store) => ({
      state: { ...store.state, analysis: { ...store.state.analysis, [assetId]: analysis } },
    })),

  markSaving: () => set({ saveStatus: 'saving', saveError: null }),
  markSaved: () => set((store) => ({
    // A change made while the save was in flight keeps the project dirty.
    saveStatus: store.saveStatus === 'saving' ? 'saved' : store.saveStatus,
    lastSavedAt: new Date().toISOString(),
  })),
  markSaveError: (message) => set({ saveStatus: 'error', saveError: message }),
}));

/** Convenience selectors that avoid re-rendering on unrelated state changes. */
export const selectClips = (s: EditorStore) => s.state.clips;
export const selectTracks = (s: EditorStore) => s.state.tracks;
export const selectSettings = (s: EditorStore) => s.state.settings;
export const selectSelectedClips = (s: EditorStore) =>
  s.state.clips.filter((c) => s.selection.clipIds.includes(c.id));
