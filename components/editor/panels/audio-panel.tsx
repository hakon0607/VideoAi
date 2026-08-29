'use client';

import { AudioLines, Scissors, Volume2 } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { Button } from '@/components/ui/button';
import { isMediaClip } from '@/types/editor';

export function AudioPanel() {
  const { t } = useI18n();
  const state = useEditorStore((s) => s.state);
  const selection = useEditorStore((s) => s.selection.clipIds);
  const dispatch = useEditorStore((s) => s.dispatch);

  const clip = state.clips.find((c) => c.id === selection[0]);
  const audible = clip && isMediaClip(clip) && clip.kind !== 'image' ? clip : null;

  const detach = () => {
    if (!audible || audible.kind !== 'video') return;
    let track = state.tracks.find((tr) => tr.kind === 'audio' && !tr.locked);
    if (!track) {
      const result = dispatch([{ type: 'create_track', params: { kind: 'audio' } }], { label: 'Add audio track' });
      const created = result.applied[0]?.action.params as { trackId?: string } | undefined;
      track = useEditorStore.getState().state.tracks.find((tr) => tr.id === created?.trackId);
    }
    if (!track) return;
    dispatch([{ type: 'detach_audio', params: { clipId: audible.id, trackId: track.id } }], {
      label: 'Detach audio',
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-muted">
        Upload music and sound effects from the Media tab. Levels and fades live in Properties.
      </p>

      {!audible ? (
        <p className="mt-4 text-center text-[12px] leading-relaxed text-ink-faint">{t('editor.noSelection')}</p>
      ) : (
        <div className="space-y-1.5">
          <Button size="sm" variant="secondary" className="w-full justify-start" onClick={detach} disabled={audible.kind !== 'video'}>
            <AudioLines size={12} /> {t('editor.detachAudio')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full justify-start"
            onClick={() =>
              dispatch(
                [{ type: 'set_audio_fade', params: { clipId: audible.id, fadeIn: 0.5, fadeOut: 0.5 } }],
                { label: 'Add fades' },
              )
            }
          >
            <Volume2 size={12} /> Add half-second fades
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full justify-start"
            onClick={() => {
              const playhead = useEditorStore.getState().playhead;
              dispatch([{ type: 'split_clip', params: { clipId: audible.id, time: playhead } }], {
                label: 'Split audio',
              });
            }}
          >
            <Scissors size={12} /> {t('editor.split')}
          </Button>
        </div>
      )}
    </div>
  );
}
