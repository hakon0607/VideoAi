'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorBootstrap } from '@/lib/actions/editor-data';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { useShortcuts } from '@/lib/hooks/use-shortcuts';
import { useMediaUrlRefresh } from '@/lib/hooks/use-media-urls-refresh';
import { useSoundEffects } from '@/lib/hooks/use-sound-effects';
import { clipEnd } from '@/lib/editor/time';
import { Topbar } from './topbar';
import { LeftPanel } from './panels/left-panel';
import { PreviewPanel } from './preview/preview-panel';
import { TimelinePanel } from './timeline/timeline-panel';
import { RightPanel } from './panels/right-panel';
import { ExportDialog } from './export/export-dialog';

export function EditorRoot({
  bootstrap,
  user,
}: {
  bootstrap: EditorBootstrap;
  user: { id: string; email: string; displayName: string; username: string; isAdmin: boolean };
}) {
  const load = useEditorStore((s) => s.load);
  const ready = useEditorStore((s) => s.ready);
  const setUrls = useMediaUrls((s) => s.set);

  const captureRef = useRef<(() => Promise<Blob | null>) | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // One-time hydration of the store from the server payload.
  useEffect(() => {
    load(bootstrap.state);
    setUrls(bootstrap.mediaUrls);
  }, [bootstrap, load, setUrls]);

  const capture = useCallback(async () => captureRef.current?.() ?? null, []);
  const { saveNow } = useAutosave(capture, user.id);
  useMediaUrlRefresh();
  useSoundEffects(bootstrap.state.projectId, user.id);

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                            */
  /* ------------------------------------------------------------------ */
  const handlers = useMemo(
    () => ({
      onPlayPause: () => {
        const store = useEditorStore.getState();
        store.setPlaying(!store.playing);
      },
      onUndo: () => useEditorStore.getState().undo(),
      onRedo: () => useEditorStore.getState().redo(),
      onSave: () => void saveNow(),
      onDelete: () => {
        const store = useEditorStore.getState();
        if (store.selection.clipIds.length === 0) return;
        store.dispatch([{ type: 'delete_clips', params: { clipIds: store.selection.clipIds } }], {
          label: 'Delete clips',
        });
      },
      onSplit: () => {
        const store = useEditorStore.getState();
        const time = store.playhead;
        const candidates = store.selection.clipIds.length
          ? store.state.clips.filter((c) => store.selection.clipIds.includes(c.id))
          : store.state.clips;
        const target = candidates.find((c) => time > c.start + 0.03 && time < clipEnd(c) - 0.03);
        if (!target) return;
        store.dispatch([{ type: 'split_clip', params: { clipId: target.id, time } }], { label: 'Split clip' });
      },
      onDuplicate: () => {
        const store = useEditorStore.getState();
        const id = store.selection.clipIds[0];
        if (!id) return;
        store.dispatch([{ type: 'duplicate_clip', params: { clipId: id } }], { label: 'Duplicate clip' });
      },
      onNudge: (frames: number) => {
        const store = useEditorStore.getState();
        store.setPlayhead(store.playhead + frames / store.state.settings.fps);
      },
      onZoom: (direction: 1 | -1) => {
        const store = useEditorStore.getState();
        store.setPixelsPerSecond(store.pixelsPerSecond * (direction === 1 ? 1.4 : 1 / 1.4));
      },
      onToggleSelectTool: () => undefined,
      onEscape: () => useEditorStore.getState().clearSelection(),
      onMarker: () => {
        const store = useEditorStore.getState();
        store.dispatch([{ type: 'add_marker', params: { time: store.playhead } }], { label: 'Add marker' });
      },
      onRippleDelete: () => {
        const store = useEditorStore.getState();
        if (store.selection.clipIds.length === 0) return;
        store.dispatch(
          store.selection.clipIds.map((clipId) => ({ type: 'ripple_delete_clip', params: { clipId } })),
          { label: 'Ripple delete' },
        );
      },
      onSelectAll: () => {
        const store = useEditorStore.getState();
        store.select(store.state.clips.map((c) => c.id));
      },
      // Up and down walk the cut points, the way every NLE does it.
      onJumpEdge: (direction: -1 | 1) => {
        const store = useEditorStore.getState();
        const edges = new Set<number>([0]);
        for (const clip of store.state.clips) {
          edges.add(clip.start);
          edges.add(clipEnd(clip));
        }
        const sorted = [...edges].sort((a, b) => a - b);
        const here = store.playhead;
        const next =
          direction === 1
            ? sorted.find((time) => time > here + 0.001)
            : [...sorted].reverse().find((time) => time < here - 0.001);
        if (next !== undefined) store.setPlayhead(next);
      },
      onGoToStart: () => useEditorStore.getState().setPlayhead(0),
      onGoToEnd: () => {
        const store = useEditorStore.getState();
        const end = store.state.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
        store.setPlayhead(end);
      },
    }),
    [saveNow],
  );

  useShortcuts(handlers, ready && !exportOpen);

  /* ------------------------------------------------------------------ */
  /* Timeline resize handle                                              */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const next = drag.startHeight - (event.clientY - drag.startY);
      setTimelineHeight(Math.max(140, Math.min(window.innerHeight * 0.65, next)));
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-base">
      <Topbar user={user} onSave={() => void saveNow()} onExport={() => setExportOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <LeftPanel userId={user.id} />

        <main id="videoai-preview-shell" className="flex min-w-0 flex-1 flex-col">
          <PreviewPanel
            onCaptureReady={(fn) => {
              captureRef.current = fn;
            }}
          />
          <div
            onPointerDown={(event) => {
              resizeRef.current = { startY: event.clientY, startHeight: timelineHeight };
            }}
            className="h-1 shrink-0 cursor-ns-resize bg-line transition-colors hover:bg-accent"
            role="separator"
            aria-orientation="horizontal"
          />
          <div style={{ height: timelineHeight }} className="shrink-0">
            <TimelinePanel />
          </div>
        </main>

        <RightPanel
          projectId={bootstrap.state.projectId}
          conversationId={bootstrap.conversationId}
          initialMessages={bootstrap.messages}
        />
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} userId={user.id} />
    </div>
  );
}
