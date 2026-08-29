'use client';

import { useCallback, useRef, useState } from 'react';
import { Captions, Film, Image as ImageIcon, Loader2, Music, Plus, Trash2, Upload } from 'lucide-react';
import type { MediaAsset } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { useI18n } from '@/lib/i18n/context';
import { formatBytes, formatClock } from '@/lib/utils/format';
import { uploadMediaFile, type UploadProgress } from '@/lib/media/upload';
import { getAssetFile, rememberFile } from '@/lib/media/file-cache';
import { InsufficientCreditsError, transcribeAsset } from '@/lib/media/transcribe';
import { createClient } from '@/lib/supabase/client';
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

export function MediaPanel({ userId }: { userId: string }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const assets = useEditorStore((s) => s.state.assets);
  const analysis = useEditorStore((s) => s.state.analysis);
  const tracks = useEditorStore((s) => s.state.tracks);
  const projectId = useEditorStore((s) => s.state.projectId);
  const dispatch = useEditorStore((s) => s.dispatch);
  const registerAsset = useEditorStore((s) => s.registerAsset);
  const setAnalysis = useEditorStore((s) => s.setAnalysis);
  const patchAsset = useEditorStore((s) => s.patchAsset);
  const addUrl = useMediaUrls((s) => s.add);
  const urls = useMediaUrls((s) => s.urls);

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
          if (result.analysis) setAnalysis(result.asset.id, result.analysis);
          if (result.signedUrl) addUrl(result.asset.id, result.signedUrl);
          setPending((p) => p.filter((item) => item.id !== id));
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : String(uploadError);
          const friendly = message.startsWith('unsupported_file')
            ? t('error.unsupportedFile')
            : message === 'file_too_large'
              ? t('error.fileTooLarge', { limit: '2 GB' })
              : message;
          setPending((p) => p.map((item) => (item.id === id ? { ...item, error: friendly } : item)));
          setError(friendly);
        }
      }
    },
    [addUrl, projectId, registerAsset, setAnalysis, t, userId],
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

  const removeAsset = useCallback(
    async (asset: MediaAsset) => {
      if (!window.confirm(`${t('common.delete')} "${asset.name}"?`)) return;
      dispatch([{ type: 'remove_asset', params: { assetId: asset.id } }], {
        label: `Remove ${asset.name}`,
      });
      const supabase = createClient();
      await supabase.from('media_assets').delete().eq('id', asset.id);
      await supabase.storage.from('media').remove([asset.storagePath]);
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

        {assets.length === 0 && pending.length === 0 && (
          <p className="mt-6 text-center text-[12px] text-ink-faint">{t('editor.noMedia')}</p>
        )}

        <div className="space-y-1.5">
          {assets.map((asset) => {
            const Icon = KIND_ICON[asset.kind];
            const hasTranscript = (analysis[asset.id]?.words.length ?? 0) > 0;
            const silences = analysis[asset.id]?.silences.length ?? 0;
            const busy = busyAssetId === asset.id;
            return (
              <div
                key={asset.id}
                className="group rounded-md border border-line bg-base p-2 transition-colors hover:border-line-strong"
              >
                <div className="flex gap-2.5">
                  <div className="relative h-11 w-16 shrink-0 overflow-hidden rounded-sm bg-elevated">
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
