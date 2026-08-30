'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '@/lib/editor/store';
import { toSavePayload } from '@/lib/editor/serialize';
import { createClient } from '@/lib/supabase/client';
import { ensureSoundEffectsPlayable, pendingSoundEffects } from '@/lib/media/sfx-provision';
import type { Json } from '@/types/database';

const DEBOUNCE_MS = 1400;
const THUMBNAIL_INTERVAL_MS = 5 * 60 * 1000;

export interface AutosaveHandle {
  saveNow: () => Promise<void>;
}

interface Controller {
  timer: number | null;
  saving: boolean;
  pending: boolean;
  lastThumbnailAt: number;
  captureThumbnail?: () => Promise<Blob | null>;
  userId?: string;
}

/**
 * Writes the whole timeline through the save_timeline RPC, which applies it
 * atomically. That is a deliberate trade: one round trip per edit burst rather
 * than a write per mouse move, and no chance of a half-saved project.
 */
async function performSave(controller: Controller): Promise<void> {
  const store = useEditorStore.getState();
  if (!store.ready || !store.state.projectId) return;
  if (controller.saving) {
    controller.pending = true;
    return;
  }
  controller.saving = true;
  store.markSaving();

  try {
    const supabase = createClient();
    let thumbnailPath: string | null = null;

    // A sound effect starts life as a placeholder asset with no row in the
    // database. Clips point at it, and clips carry a foreign key, so the whole
    // save would be rejected until the sound is a real file. Uploading it first
    // is what makes an assistant-scored edit saveable.
    if (controller.userId && pendingSoundEffects().length > 0) {
      await ensureSoundEffectsPlayable(store.state.projectId, controller.userId);
      const stillPending = pendingSoundEffects();
      if (stillPending.length > 0) {
        throw new Error(
          `Could not upload ${stillPending.length} sound effect${stillPending.length === 1 ? '' : 's'}. ` +
            'The project was not saved; check your connection and try again.',
        );
      }
    }

    const needsThumbnail =
      controller.captureThumbnail &&
      controller.userId &&
      store.state.clips.length > 0 &&
      Date.now() - controller.lastThumbnailAt > THUMBNAIL_INTERVAL_MS;

    if (needsThumbnail && controller.captureThumbnail) {
      try {
        const blob = await controller.captureThumbnail();
        if (blob) {
          const path = `user/${controller.userId}/projects/${store.state.projectId}/thumbnail.jpg`;
          const { error } = await supabase.storage
            .from('media')
            .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
          if (!error) {
            thumbnailPath = path;
            controller.lastThumbnailAt = Date.now();
          }
        }
      } catch {
        // A thumbnail is a nicety; never let it break the save.
      }
    }

    const payload = toSavePayload(useEditorStore.getState().state, thumbnailPath);
    const { error } = await supabase.rpc('save_timeline', { p_payload: payload as unknown as Json });
    if (error) throw new Error(error.message);
    useEditorStore.getState().markSaved();
  } catch (error) {
    useEditorStore.getState().markSaveError(error instanceof Error ? error.message : 'Save failed');
  } finally {
    controller.saving = false;
    if (controller.pending) {
      controller.pending = false;
      void performSave(controller);
    }
  }
}

/** Debounced autosave, plus a manual saveNow for ⌘S and the Save button. */
export function useAutosave(captureThumbnail?: () => Promise<Blob | null>, userId?: string): AutosaveHandle {
  const controllerRef = useRef<Controller>({
    timer: null,
    saving: false,
    pending: false,
    lastThumbnailAt: 0,
  });

  useEffect(() => {
    controllerRef.current.captureThumbnail = captureThumbnail;
    controllerRef.current.userId = userId;
  }, [captureThumbnail, userId]);

  useEffect(() => {
    const controller = controllerRef.current;
    const unsubscribe = useEditorStore.subscribe((store, previous) => {
      if (store.state === previous.state || !store.ready) return;
      if (controller.timer) window.clearTimeout(controller.timer);
      controller.timer = window.setTimeout(() => void performSave(controller), DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (controller.timer) window.clearTimeout(controller.timer);
    };
  }, []);

  // Best-effort flush when the tab goes away.
  useEffect(() => {
    const controller = controllerRef.current;
    const onHide = () => {
      if (useEditorStore.getState().saveStatus === 'dirty') void performSave(controller);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  const saveNow = useCallback(async () => {
    const controller = controllerRef.current;
    if (controller.timer) window.clearTimeout(controller.timer);
    await performSave(controller);
  }, []);

  return { saveNow };
}
