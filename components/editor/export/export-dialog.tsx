'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import type { ExportFormat, ExportQuality, ExportSettings } from '@/types/editor';
import { EXPORT_QUALITIES } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { useI18n } from '@/lib/i18n/context';
import { RESOLUTION_PRESETS } from '@/lib/editor/defaults';
import { timelineDuration } from '@/lib/editor/selectors';
import { formatBytes, formatClock } from '@/lib/utils/format';
import {
  ExportCancelledError,
  checkExportSupport,
  checkProjectDecodable,
  exportProject,
  missingMediaFor,
  type ExportProgress,
} from '@/lib/render/export';
import { createClient } from '@/lib/supabase/client';
import type { Json } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ToggleControl } from '../panels/controls';

const QUALITY_KEYS = {
  low: 'export.quality.low',
  medium: 'export.quality.medium',
  high: 'export.quality.high',
  very_high: 'export.quality.very_high',
} as const;

export function ExportDialog({
  open,
  onClose,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
}) {
  const { t } = useI18n();
  const state = useEditorStore((s) => s.state);
  const urls = useMediaUrls((s) => s.urls);
  const abortRef = useRef<AbortController | null>(null);

  const presets = RESOLUTION_PRESETS[state.settings.aspectRatio];
  const [resolutionIndex, setResolutionIndex] = useState(() =>
    Math.max(0, presets.findIndex((p) => p.height === state.settings.height)),
  );
  const [fps, setFps] = useState(state.settings.fps);
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [saveCopy, setSaveCopy] = useState(false);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [undecodable, setUndecodable] = useState<string[]>([]);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<{ url: string; name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const duration = useMemo(() => timelineDuration(state), [state]);
  const missing = useMemo(() => missingMediaFor(state, urls), [state, urls]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Both checks are async, so the dialog can warn about an unsupported codec
    // before the user commits to a render.
    const probe = async () => {
      const support = await checkExportSupport();
      if (cancelled) return;
      setSupported(support.supported);
      const problems = await checkProjectDecodable(
        useEditorStore.getState().state,
        useMediaUrls.getState().urls,
      );
      if (!cancelled) setUndecodable(problems);
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    const preset = presets[resolutionIndex] ?? presets[0];
    const settings: ExportSettings = {
      width: preset.width,
      height: preset.height,
      fps,
      format,
      quality,
      includeAudio,
      rangeStart: null,
      rangeEnd: null,
    };

    const supabase = createClient();
    const { data: job } = await supabase
      .from('exports')
      .insert({
        project_id: state.projectId,
        user_id: userId,
        status: 'rendering',
        engine: 'browser',
        settings: settings as unknown as Json,
      })
      .select('id')
      .single();

    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ stage: 'preparing', fraction: 0 });

    try {
      const output = await exportProject(state, urls, settings, setProgress, controller.signal);
      const url = URL.createObjectURL(output.blob);
      setResult({ url, name: output.fileName, size: output.blob.size });

      let outputPath: string | null = null;
      if (saveCopy && job?.id) {
        outputPath = `user/${userId}/projects/${state.projectId}/${job.id}-${output.fileName}`;
        const { error: uploadError } = await supabase.storage
          .from('exports')
          .upload(outputPath, output.blob, { upsert: true, contentType: output.blob.type });
        if (uploadError) outputPath = null;
      }

      if (job?.id) {
        await supabase
          .from('exports')
          .update({
            status: 'completed',
            progress: 1,
            output_path: outputPath,
            size_bytes: output.blob.size,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }
    } catch (exportError) {
      const cancelled = exportError instanceof ExportCancelledError;
      const message = exportError instanceof Error ? exportError.message : String(exportError);
      if (!cancelled) setError(message);
      if (job?.id) {
        await supabase
          .from('exports')
          .update({
            status: cancelled ? 'cancelled' : 'failed',
            error_message: cancelled ? null : message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }, [fps, format, includeAudio, presets, quality, resolutionIndex, saveCopy, state, urls, userId]);

  const busy = progress !== null;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      title={t('export.title')}
      description={t('export.note')}
      width="sm"
      footer={
        result ? (
          <>
            <Button onClick={onClose}>{t('common.close')}</Button>
            <a
              href={result.url}
              download={result.name}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              <Download size={14} /> {t('export.download')}
            </a>
          </>
        ) : busy ? (
          <Button
            variant="danger"
            onClick={() => {
              abortRef.current?.abort();
            }}
          >
            {t('export.cancel')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => void start()} disabled={duration <= 0 || supported === false}>
              {t('export.start')}
            </Button>
          </>
        )
      }
    >
      {supported === false ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
          {t('export.unsupported')}
        </p>
      ) : duration <= 0 ? (
        <p className="text-[12.5px] text-ink-muted">{t('export.emptyTimeline')}</p>
      ) : result ? (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-positive">{t('export.done')}</p>
          <p className="text-[12.5px] text-ink-muted">
            {result.name} · {formatBytes(result.size)}
          </p>
        </div>
      ) : busy ? (
        <div className="space-y-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <p className="text-[12.5px] text-ink-muted">
            {t('export.rendering', { percent: Math.round(progress.fraction * 100) })}
            {progress.totalFrames ? ` · ${progress.frame}/${progress.totalFrames}` : ''}
            {progress.stage === 'audio' ? ' · audio' : ''}
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {undecodable.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-danger">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              This browser cannot decode {undecodable.join(', ')}. Export will fail until the file is re-encoded, or you
              open the project in Chrome or Edge.
            </p>
          )}

          {missing.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-warning">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              Media for {missing.slice(0, 3).join(', ')} could not be loaded and will render as background.
            </p>
          )}

          <Field label={t('export.resolution')}>
            <Select value={resolutionIndex} onChange={(e) => setResolutionIndex(Number(e.target.value))}>
              {presets.map((preset, index) => (
                <option key={preset.label} value={index}>
                  {preset.label} — {preset.width}×{preset.height}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('export.fps')}>
              <Select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {[24, 25, 30, 50, 60].map((value) => (
                  <option key={value} value={value}>
                    {value} fps
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('export.format')}>
              <Select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                <option value="mp4">MP4 (H.264)</option>
                <option value="webm">WebM (VP9)</option>
              </Select>
            </Field>
          </div>

          <Field label={t('export.quality')}>
            <Select value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)}>
              {EXPORT_QUALITIES.map((value) => (
                <option key={value} value={value}>
                  {t(QUALITY_KEYS[value])}
                </option>
              ))}
            </Select>
          </Field>

          <div className="space-y-2 rounded-md border border-line bg-base px-3 py-2.5">
            <ToggleControl label="Include audio" checked={includeAudio} onChange={setIncludeAudio} />
            <ToggleControl label="Also save a copy to this project" checked={saveCopy} onChange={setSaveCopy} />
          </div>

          <p className="text-[11.5px] text-ink-faint">
            {formatClock(duration)} · about {Math.round(duration * fps)} frames
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {t('export.failed')}: {error}
        </p>
      )}
    </Modal>
  );
}
