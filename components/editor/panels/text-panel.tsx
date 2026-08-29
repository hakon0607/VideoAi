'use client';

import { Type } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { Button } from '@/components/ui/button';

interface Preset {
  id: string;
  label: string;
  text: string;
  style: Record<string, unknown>;
  y: number;
  animation: string;
}

const PRESETS: Preset[] = [
  {
    id: 'title',
    label: 'Title',
    text: 'Your title',
    style: { fontSize: 0.1, fontWeight: 800, strokeWidth: 0 },
    y: -0.05,
    animation: 'pop',
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    text: 'A short line underneath',
    style: { fontSize: 0.05, fontWeight: 500, color: '#d5d8e0' },
    y: 0.08,
    animation: 'fade',
  },
  {
    id: 'lower_third',
    label: 'Lower third',
    text: 'Name · Role',
    style: {
      fontSize: 0.042,
      fontWeight: 600,
      align: 'left',
      backgroundColor: 'rgba(0,0,0,0.55)',
      backgroundPadding: 0.018,
      maxWidth: 0.5,
    },
    y: 0.33,
    animation: 'slide_up',
  },
  {
    id: 'caption',
    label: 'Caption style',
    text: 'Big readable caption',
    style: { fontSize: 0.055, fontWeight: 800, strokeWidth: 0.004 },
    y: 0.33,
    animation: 'none',
  },
  {
    id: 'callout',
    label: 'Callout',
    text: 'Watch this',
    style: { fontSize: 0.06, fontWeight: 800, color: '#ffd166', strokeWidth: 0.005 },
    y: -0.25,
    animation: 'pop',
  },
];

export function TextPanel() {
  const { t } = useI18n();
  const tracks = useEditorStore((s) => s.state.tracks);
  const dispatch = useEditorStore((s) => s.dispatch);

  const addText = (preset: Preset) => {
    let track = tracks.find((tr) => (tr.kind === 'text' || tr.kind === 'overlay') && !tr.locked);
    if (!track) {
      const result = dispatch([{ type: 'create_track', params: { kind: 'text' } }], { label: 'Add text track' });
      const created = result.applied[0]?.action.params as { trackId?: string } | undefined;
      track = useEditorStore.getState().state.tracks.find((tr) => tr.id === created?.trackId);
    }
    if (!track) return;
    const playhead = useEditorStore.getState().playhead;
    dispatch(
      [
        {
          type: 'add_text',
          params: {
            trackId: track.id,
            text: preset.text,
            start: playhead,
            duration: 3,
            style: preset.style,
            animation: preset.animation,
            y: preset.y,
          },
        },
      ],
      { label: 'Add text' },
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-muted">
        Text lands at the playhead. Select it afterwards to restyle, or just ask the assistant.
      </p>
      <div className="space-y-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => addText(preset)}
            className="flex w-full items-center gap-2.5 rounded-md border border-line bg-base px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-elevated"
          >
            <Type size={13} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-ink">{preset.label}</span>
              <span className="block truncate text-[11px] text-ink-faint">{preset.text}</span>
            </span>
          </button>
        ))}
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="mt-3 w-full"
        onClick={() => addText(PRESETS[0])}
      >
        {t('editor.addText')}
      </Button>
    </div>
  );
}
