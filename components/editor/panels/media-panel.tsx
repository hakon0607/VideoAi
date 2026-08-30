'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Captions,
  CloudOff,
  ChevronRight,
  Film,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Music,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { MediaAsset } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { useI18n } from '@/lib/i18n/context';
import { formatBytes, formatClock } from '@/lib/utils/format';
import { uploadMediaFile, type UploadProgress } from '@/lib/media/upload';
import { getAssetFile, rememberFile } from '@/lib/media/file-cache';
import { InsufficientCreditsError, transcribeAsset } from '@/lib/media/transcribe';
import { deleteAssetAction } from '@/lib/actions/projects';
import { useRelinkMedia } from '@/lib/hooks/use-local-media';
import { deleteLocalFile } from '@/lib/media/local-store';
import { LOCAL_PREFIX, originOf, releaseObjectUrl } from '@/lib/media/media-source';
import { isMediaDrag, readMediaDrag, writeMediaDrag } from '@/components/editor/timeline/drag-payload';
import { UploadTooLargeError } from '@/lib/media/resumable';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';

interface PendingUpload {
  id: string;
  name: string;
  progress: UploadProgress;
  error?: string;
}

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon } as const;

/** Turns an upload failure into something the user can act on. */
function describeUploadError(error: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (error instanceof UploadTooLargeError) {
    return t('error.storageLimit', {
      size: formatBytes(error.fileBytes),
      limit: formatBytes(error.limitBytes),
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('unsupported_file')) return t('error.unsupportedFile');
  if (message === 'storage_limit' || message.includes('exceeded the maximum')) {
    return t('error.storageLimitUnknown');
  }
  if (message === 'cancelled') return t('common.cancel');
  return message || t('error.uploadFailed');
}

export function MediaPanel({ userId }: { userId: string }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [search, setSearch] = useState('');

  const allAssets = useEditorStore((s) => s.state.assets);
  const folders = useEditorStore((s) => s.state.folders);
  const analysis = useEditorStore((s) => s.state.analysis);
  const tracks = useEditorStore((s) => s.state.tracks);
  const projectId = useEditorStore((s) => s.state.projectId);
  const dispatch = useEditorStore((s) => s.dispatch);
  const registerAsset = useEditorStore((s) => s.registerAsset);
  const setAnalysis = useEditorStore((s) => s.setAnalysis);
  const patchAsset = useEditorStore((s) => s.patchAsset);
  const addUrl = useMediaUrls((s) => s.add);
  const urls = useMediaUrls((s) => s.urls);
  const missingIds = useMediaUrls((s) => s.missing);
  const { missing, relink, busy: relinking } = useRelinkMedia();
  const relinkInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      for (const file of Array.from(files)) {
        const id = `${file.name}-${file.size}-${Date.now()}`;
        setPending((p) => [...p, { id, name: file.name, progress: { stage: 'probing', fraction: 0 } }]);
        try {
          const result = await uploadMediaFile(file, projectId, userId, (progress) =>
            setPending((p) => p.map((item) => (item.id === id ? { ...item, progress } : item))),
          );
          rememberFile(result.asset.id, file);
          registerAsset(result.asset);
          // Anything uploaded while a bin is open lands in that bin.
          if (folderId) {
            dispatch(
              [{ type: 'move_media_to_folder', params: { assetIds: [result.asset.id], folderId } }],
              { label: 'File media', silent: true },
            );
          }
          if (result.analysis) setAnalysis(result.asset.id, result.analysis);
          if (result.signedUrl) addUrl(result.asset.id, result.signedUrl);
          setPending((p) => p.filter((item) => item.id !== id));
        } catch (uploadError) {
          const friendly = describeUploadError(uploadError, t);
          setPending((p) => p.map((item) => (item.id === id ? { ...item, error: friendly } : item)));
          setError(friendly);
        }
      }
    },
    [addUrl, dispatch, folderId, projectId, registerAsset, setAnalysis, t, userId],
  );

  const addToTimeline = useCallback(
    (asset: MediaAsset) => {
      const wanted = asset.kind === 'audio' ? 'audio' : 'video';
      let track = tracks.find((tr) => tr.kind === wanted && !tr.locked);
      if (!track) {
        const result = dispatch([{ type: 'create_track', params: { kind: wanted } }], { label: 'Add track' });
        const created = result.applied[0]?.action.params as { trackId?: string } | undefined;
        track = useEditorStore.getState().state.tracks.find((tr) => tr.id === created?.trackId);
      }
      if (!track) return;
      dispatch([{ type: 'create_clip', params: { trackId: track.id, assetId: asset.id } }], {
        label: `Add ${asset.name}`,
      });
    },
    [dispatch, tracks],
  );

  const transcribe = useCallback(
    async (asset: MediaAsset) => {
      setError(null);
      setBusyAssetId(asset.id);
      setBusyLabel(t('editor.analyzing'));
      patchAsset(asset.id, { analysisStatus: 'transcribing' });
      try {
        const file = await getAssetFile(asset, urls[asset.id]);
        const result = await transcribeAsset(file, asset.id, projectId, (progress) => {
          setBusyLabel(
            progress.stage === 'extracting'
              ? `${t('editor.analyzing')} ${Math.round(progress.fraction * 100)}%`
              : `${t('editor.analyzing')} ${progress.chunk ?? 1}/${progress.chunks ?? 1}`,
          );
        });
        const existing = analysis[asset.id];
        setAnalysis(asset.id, { ...result, silences: existing?.silences ?? [], loudnessDb: existing?.loudnessDb ?? null });
        patchAsset(asset.id, { analysisStatus: 'analyzed' });
      } catch (transcribeError) {
        patchAsset(asset.id, { analysisStatus: 'failed' });
        if (transcribeError instanceof InsufficientCreditsError) {
          setError(t('credits.empty.title'));
        } else {
          setError(transcribeError instanceof Error ? transcribeError.message : t('editor.analysisFailed'));
        }
      } finally {
        setBusyAssetId(null);
        setBusyLabel('');
      }
    },
    [analysis, patchAsset, projectId, setAnalysis, t, urls],
  );

  /* -------------------------------------------------------------------- */
  /* Folders                                                               */
  /* -------------------------------------------------------------------- */
  const currentFolder = folders.find((f) => f.id === folderId) ?? null;
  const childFolders = folders.filter((f) => f.parentId === folderId);
  const needle = search.trim().toLowerCase();
  // A search looks through the whole library; without one you see the bin
  // you are standing in.
  const assets = needle
    ? allAssets.filter((a) => a.name.toLowerCase().includes(needle))
    : allAssets.filter((a) => (a.folderId ?? null) === folderId);

  const createFolder = useCallback(() => {
    const name = window.prompt(t('editor.newFolderPrompt'), t('editor.newFolder'));
    if (!name?.trim()) return;
    dispatch(
      [{ type: 'create_media_folder', params: { name: name.trim(), parentId: folderId } }],
      { label: 'New folder' },
    );
  }, [dispatch, folderId, t]);

  const renameFolder = useCallback(
    (id: string, name: string) => {
      setRenaming(null);
      const trimmed = name.trim();
      if (!trimmed) return;
      dispatch([{ type: 'rename_media_folder', params: { folderId: id, name: trimmed } }], {
        label: 'Rename folder',
      });
    },
    [dispatch],
  );

  const deleteFolder = useCallback(
    (id: string, name: string) => {
      if (!window.confirm(t('editor.deleteFolderConfirm', { name }))) return;
      dispatch([{ type: 'delete_media_folder', params: { folderId: id } }], { label: 'Delete folder' });
    },
    [dispatch, t],
  );

  const moveToFolder = useCallback(
    (assetIds: string[], target: string | null) => {
      dispatch([{ type: 'move_media_to_folder', params: { assetIds, folderId: target } }], {
        label: 'Move media',
      });
    },
    [dispatch],
  );

  const removeAsset = useCallback(
    async (asset: MediaAsset) => {
      if (!window.confirm(`${t('common.delete')} "${asset.name}"?`)) return;
      dispatch([{ type: 'remove_asset', params: { assetId: asset.id } }], {
        label: `Remove ${asset.name}`,
      });
      // A local file lives on this machine only, so it is removed here; the
      // server action still drops the row, and the bucket object when the file
      // was a cloud upload no other project points at.
      if (asset.storagePath.startsWith(LOCAL_PREFIX)) {
        await deleteLocalFile(asset.storagePath.slice(LOCAL_PREFIX.length));
      }
      releaseObjectUrl(asset.id);
      const result = await deleteAssetAction(asset.id);
      if (!result.ok && result.error) setError(result.error);
    },
    [dispatch, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'mx-3 mt-3 cursor-pointer rounded-md border border-dashed px-3 py-5 text-center transition-colors',
          dragOver ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
        )}
      >
        <Upload size={16} className="mx-auto mb-1.5 text-ink-faint" />
        <p className="text-[12.5px] font-medium text-ink">{t('editor.upload')}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-faint">{t('editor.uploadHint')}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="mx-3 mt-2 rounded-sm border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11.5px] text-danger">
          {error}
        </p>
      )}

      {missing.length > 0 && (
        <div className="mx-3 mt-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
          <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warning">
            <CloudOff size={12} className="mt-0.5 shrink-0" />
            {t('editor.mediaOffline', { count: missing.length })}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-1.5 w-full"
            disabled={relinking}
            onClick={() => relinkInputRef.current?.click()}
          >
            {relinking ? <Loader2 size={11} className="animate-spin-slow" /> : null}
            {t('editor.relink')}
          </Button>
          <input
            ref={relinkInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={async (event) => {
              if (!event.target.files?.length) return;
              const result = await relink(event.target.files);
              event.target.value = '';
              if (result.unmatched.length) {
                setError(t('editor.relinkUnmatched', { names: result.unmatched.join(', ') }));
              } else {
                setError(null);
              }
            }}
          />
        </div>
      )}

      <div className="mt-2 flex shrink-0 items-center gap-1 px-3">
        <div className="flex min-w-0 flex-1 items-center text-[11.5px] text-ink-faint">
          <button
            onClick={() => setFolderId(null)}
            onDragOver={(e) => {
              if (!isMediaDrag(e)) return;
              e.preventDefault();
              setDropFolderId('__root__');
            }}
            onDragLeave={() => setDropFolderId(null)}
            onDrop={(e) => {
              const payload = readMediaDrag(e);
              setDropFolderId(null);
              if (!payload) return;
              e.preventDefault();
              e.stopPropagation();
              moveToFolder([payload.assetId], null);
            }}
            className={cn(
              'shrink-0 rounded-xs px-1 py-0.5 transition-colors hover:text-ink',
              !currentFolder && 'text-ink',
              dropFolderId === '__root__' && 'bg-accent-soft text-accent',
            )}
          >
            {t('editor.allMedia')}
          </button>
          {currentFolder && (
            <>
              <ChevronRight size={11} className="shrink-0" />
              <span className="truncate px-1 text-ink">{currentFolder.name}</span>
            </>
          )}
        </div>
        <Tooltip label={t('editor.newFolder')} side="top">
          <button
            onClick={createFolder}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-faint transition-colors hover:bg-elevated hover:text-ink"
          >
            <FolderPlus size={12} />
          </button>
        </Tooltip>
        <Tooltip label={view === 'list' ? t('editor.gridView') : t('editor.listView')} side="top">
          <button
            onClick={() => setView((v) => (v === 'list' ? 'grid' : 'list'))}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-faint transition-colors hover:bg-elevated hover:text-ink"
          >
            {view === 'list' ? <LayoutGrid size={12} /> : <List size={12} />}
          </button>
        </Tooltip>
      </div>

      <div className="mt-1.5 shrink-0 px-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('editor.searchMedia')}
          className="h-7 w-full rounded-sm border border-line bg-base px-2 text-[12px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {pending.map((item) => (
          <div key={item.id} className="mb-2 rounded-md border border-line bg-base px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12px] text-ink">{item.name}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">
                {item.error ? '—' : `${Math.round(item.progress.fraction * 100)}%`}
              </span>
            </div>
            {item.error ? (
              <p className="mt-1 text-[11px] text-danger">{item.error}</p>
            ) : (
              <>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-accent transition-[width] duration-200"
                    style={{ width: `${Math.round(item.progress.fraction * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10.5px] text-ink-faint capitalize">{item.progress.stage}</p>
              </>
            )}
          </div>
        ))}

        {childFolders.length > 0 && !needle && (
          <div className="mb-2 space-y-1">
            {childFolders.map((folder) => {
              const count = allAssets.filter((a) => a.folderId === folder.id).length;
              return (
                <div
                  key={folder.id}
                  onDoubleClick={() => setFolderId(folder.id)}
                  onDragOver={(e) => {
                    if (!isMediaDrag(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropFolderId(folder.id);
                  }}
                  onDragLeave={() => setDropFolderId((id) => (id === folder.id ? null : id))}
                  onDrop={(e) => {
                    const payload = readMediaDrag(e);
                    setDropFolderId(null);
                    if (!payload) return;
                    e.preventDefault();
                    e.stopPropagation();
                    moveToFolder([payload.assetId], folder.id);
                  }}
                  className={cn(
                    'group flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors',
                    dropFolderId === folder.id
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-base hover:border-line-strong',
                  )}
                >
                  <Folder size={13} className="shrink-0 text-ink-faint" />
                  {renaming === folder.id ? (
                    <input
                      autoFocus
                      defaultValue={folder.name}
                      onBlur={(e) => renameFolder(folder.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="min-w-0 flex-1 rounded-xs border border-accent bg-base px-1 text-[12px] text-ink focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => setFolderId(folder.id)}
                      className="min-w-0 flex-1 truncate text-left text-[12px] text-ink"
                    >
                      {folder.name}
                    </button>
                  )}
                  <span className="shrink-0 text-[10.5px] text-ink-faint">{count}</span>
                  <button
                    onClick={() => setRenaming(folder.id)}
                    title={t('common.rename')}
                    className="shrink-0 rounded-xs p-1 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => deleteFolder(folder.id, folder.name)}
                    title={t('common.delete')}
                    className="shrink-0 rounded-xs p-1 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {assets.length === 0 && pending.length === 0 && childFolders.length === 0 && (
          <p className="mt-6 text-center text-[12px] text-ink-faint">
            {needle ? t('editor.noResults') : t('editor.noMedia')}
          </p>
        )}

        {assets.length > 0 && (
          <p className="mb-2 text-[11px] text-ink-faint">{t('editor.dragToTimeline')}</p>
        )}

        <div className={cn(view === 'grid' ? 'grid grid-cols-2 gap-1.5' : 'space-y-1.5')}>
          {assets.map((asset) => {
            const Icon = KIND_ICON[asset.kind];
            const hasTranscript = (analysis[asset.id]?.words.length ?? 0) > 0;
            const silences = analysis[asset.id]?.silences.length ?? 0;
            const busy = busyAssetId === asset.id;
            return (
              <div
                key={asset.id}
                draggable
                onDragStart={(event) =>
                  writeMediaDrag(event, {
                    assetId: asset.id,
                    kind: asset.kind,
                    duration: asset.duration,
                    name: asset.name,
                  })
                }
                title={`${asset.name} — ${t('editor.dragToTimeline')}`}
                className="group cursor-grab rounded-md border border-line bg-base p-2 transition-colors hover:border-line-strong active:cursor-grabbing"
              >
                <div className={cn(view === 'grid' ? 'flex flex-col gap-1.5' : 'flex gap-2.5')}>
                  <div
                    className={cn(
                      'relative shrink-0 overflow-hidden rounded-sm bg-elevated',
                      view === 'grid' ? 'aspect-video w-full' : 'h-11 w-16',
                    )}
                  >
                    {asset.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-ink-faint">
                        <Icon size={14} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-ink">{asset.name}</p>
                    <p className="mt-0.5 text-[10.5px] text-ink-faint">
                      {asset.duration > 0 ? formatClock(asset.duration) : formatBytes(asset.sizeBytes)}
                      {asset.width ? ` · ${asset.width}×${asset.height}` : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {missingIds.includes(asset.id) && (
                        <span className="rounded-xs bg-warning/15 px-1.5 py-px text-[9.5px] text-warning">
                          {t('editor.offline')}
                        </span>
                      )}
                      {originOf(asset.storagePath) === 'generated' && (
                        <span className="rounded-xs bg-accent-soft px-1.5 py-px text-[9.5px] text-accent">
                          {t('editor.generated')}
                        </span>
                      )}
                      {hasTranscript && (
                        <span className="rounded-xs bg-positive/15 px-1.5 py-px text-[9.5px] text-positive">
                          {t('editor.analyzed')}
                        </span>
                      )}
                      {silences > 0 && (
                        <span className="rounded-xs bg-elevated px-1.5 py-px text-[9.5px] text-ink-faint">
                          {silences} pauses
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => addToTimeline(asset)}>
                    <Plus size={11} /> {t('editor.addToTimeline')}
                  </Button>
                  {asset.kind !== 'image' && asset.hasAudio && (
                    <Tooltip label={t('editor.analyze')} side="top">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void transcribe(asset)}
                        disabled={busy}
                        className="px-2"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin-slow" /> : <Captions size={12} />}
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip label={t('common.delete')} side="top">
                    <Button size="sm" variant="ghost" onClick={() => void removeAsset(asset)} className="px-2">
                      <Trash2 size={12} />
                    </Button>
                  </Tooltip>
                </div>
                {busy && <p className="mt-1 text-[10.5px] text-accent">{busyLabel}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
