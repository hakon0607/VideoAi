'use client';

import { useEffect } from 'react';
import { useEditorStore } from '@/lib/editor/store';
import { ensureSoundEffectsPlayable, pendingSoundEffects } from '@/lib/media/sfx-provision';

/**
 * Renders, uploads and signs any built-in sound the project has picked up.
 *
 * Adding a whoosh is a pure editor action: it puts a placeholder asset in the
 * project and nothing else, so the same command works on the server when the
 * assistant plans an edit. This watches for those placeholders wherever they
 * come from — the sounds panel, the assistant, a redo — and turns them into
 * real files, so the sound plays in the preview, survives a reload and lands in
 * the exported audio.
 */
export function useSoundEffects(projectId: string, userId: string): void {
  useEffect(() => {
    if (!projectId || !userId) return;
    const run = () => {
      if (pendingSoundEffects().length === 0) return;
      void ensureSoundEffectsPlayable(projectId, userId);
    };
    run();
    return useEditorStore.subscribe((store, previous) => {
      if (store.state.assets !== previous.state.assets) run();
    });
  }, [projectId, userId]);
}
