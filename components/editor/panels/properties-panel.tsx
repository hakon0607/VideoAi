'use client';

import { useCallback } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  FlipHorizontal,
  FlipVertical,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { Clip, MediaClip, TextClip } from '@/types/editor';
import { AUDIO_FILTERS, EASINGS, TEXT_ANIMATIONS, isMediaClip, isTextClip } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import type { DictionaryKey } from '@/lib/i18n/dictionaries';
import { clipEnd } from '@/lib/editor/time';
import { EFFECT_RANGES } from '@/lib/editor/defaults';
import { Button } from '@/components/ui/button';
import {
  ColorControl,
  NumberControl,
  PanelSection,
  Row,
  SegmentedControl,
  SliderControl,
  ToggleControl,
} from './controls';

export function PropertiesPanel() {
  const { t } = useI18n();
  const clips = useEditorStore((s) => s.state.clips);
  const selection = useEditorStore((s) => s.selection.clipIds);
  const dispatch = useEditorStore((s) => s.dispatch);

  const clip = clips.find((c) => c.id === selection[0]);

  const run = useCallback(
    (type: string, params: Record<string, unknown>, label: string) => {
      dispatch([{ type, params }], { label });
    },
    [dispatch],
  );

  if (!clip) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <p className="text-[12px] leading-relaxed text-ink-faint">{t('editor.noSelection')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PanelSection title={clip.kind}>
        <Row label={t('editor.name')}>
          <input
            defaultValue={clip.name}
            key={clip.id}
            onBlur={(e) =>
              e.target.value !== clip.name &&
              run('set_clip_properties', { clipId: clip.id, name: e.target.value }, 'Rename clip')
            }
            className="h-7 w-full rounded-sm border border-line bg-base px-2 text-[12px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
          />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <NumberControl
            label={t('editor.start')}
            value={clip.start}
            step={0.1}
            min={0}
            suffix="s"
            onCommit={(value) => run('move_clip', { clipId: clip.id, start: value }, 'Move clip')}
          />
          <NumberControl
            label={t('editor.end')}
            value={clipEnd(clip)}
            step={0.1}
            suffix="s"
            onCommit={(value) => run('trim_clip', { clipId: clip.id, end: value }, 'Trim clip')}
          />
        </div>
        <ToggleControl
          label={t('editor.locked')}
          checked={clip.locked}
          onChange={(locked) => run('set_clip_properties', { clipId: clip.id, locked }, 'Lock clip')}
        />
      </PanelSection>

      {isTextClip(clip) && <TextProperties clip={clip} run={run} />}
      {isMediaClip(clip) && clip.kind !== 'audio' && <VisualProperties clip={clip} run={run} />}
      {isMediaClip(clip) && clip.kind !== 'image' && <AudioProperties clip={clip} run={run} />}
      {isMediaClip(clip) && clip.kind !== 'image' && <AudioProcessingSection clip={clip} run={run} />}
      {clip.kind !== 'audio' && <EffectsSection clip={clip} run={run} />}
      <TransitionSection clip={clip} run={run} />
      <KeyframeSection clip={clip} run={run} />
    </div>
  );
}

type Run = (type: string, params: Record<string, unknown>, label: string) => void;

function TextProperties({ clip, run }: { clip: TextClip; run: Run }) {
  const { t } = useI18n();
  const style = clip.style;
  const patch = (partial: Record<string, unknown>) =>
    run('set_text_style', { clipId: clip.id, style: partial }, 'Restyle text');

  return (
    <PanelSection title={t('editor.text')}>
      <textarea
        key={clip.id}
        defaultValue={clip.text}
        rows={2}
        onBlur={(e) =>
          e.target.value !== clip.text &&
          run('set_text_content', { clipId: clip.id, text: e.target.value }, 'Edit text')
        }
        className="w-full resize-y rounded-sm border border-line bg-base px-2 py-1.5 text-[12px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
      />
      <SliderControl
        label={t('editor.fontSize')}
        value={style.fontSize}
        min={0.01}
        max={0.3}
        step={0.002}
        format={(v) => `${Math.round(v * 1000) / 10}%`}
        onCommit={(fontSize) => patch({ fontSize })}
      />
      <SliderControl
        label={t('editor.weight')}
        value={style.fontWeight}
        min={100}
        max={900}
        step={100}
        format={(v) => String(Math.round(v))}
        onCommit={(fontWeight) => patch({ fontWeight: Math.round(fontWeight) })}
      />
      <SegmentedControl
        label={t('editor.align')}
        value={style.align}
        options={[
          { value: 'left', label: '', icon: <AlignLeft size={12} /> },
          { value: 'center', label: '', icon: <AlignCenter size={12} /> },
          { value: 'right', label: '', icon: <AlignRight size={12} /> },
        ]}
        onChange={(align) => patch({ align })}
      />
      <ColorControl label={t('editor.color')} value={style.color} onCommit={(color) => patch({ color })} />
      <ColorControl
        label={t('editor.background')}
        value={style.backgroundColor}
        onCommit={(backgroundColor) => patch({ backgroundColor })}
      />
      <SliderControl
        label={t('editor.outline')}
        value={style.strokeWidth}
        min={0}
        max={0.02}
        step={0.0005}
        format={(v) => v.toFixed(4)}
        onCommit={(strokeWidth) => patch({ strokeWidth })}
      />
      <Row label={t('editor.animation')}>
        <select
          value={clip.animation}
          onChange={(e) =>
            run('set_text_animation', { clipId: clip.id, animation: e.target.value }, 'Text animation')
          }
          className="h-7 w-full rounded-sm border border-line bg-base px-1.5 text-[11.5px] text-ink"
        >
          {TEXT_ANIMATIONS.map((animation) => (
            <option key={animation} value={animation}>
              {t(`animation.${animation}` as DictionaryKey)}
            </option>
          ))}
        </select>
      </Row>
      <ToggleControl label={t('editor.uppercase')} checked={style.uppercase} onChange={(uppercase) => patch({ uppercase })} />
    </PanelSection>
  );
}

function VisualProperties({ clip, run }: { clip: MediaClip; run: Run }) {
  const { t } = useI18n();
  const transform = clip.transform;

  return (
    <PanelSection title={t('editor.position')}>
      <SliderControl
        label={t('editor.scale')}
        value={transform.scale}
        min={0.1}
        max={4}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(scale) => run('set_transform', { clipId: clip.id, scale }, 'Scale clip')}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberControl
          label="X"
          value={transform.x}
          step={0.01}
          onCommit={(x) => run('set_transform', { clipId: clip.id, x }, 'Move clip')}
        />
        <NumberControl
          label="Y"
          value={transform.y}
          step={0.01}
          onCommit={(y) => run('set_transform', { clipId: clip.id, y }, 'Move clip')}
        />
      </div>
      <SliderControl
        label={t('editor.rotation')}
        value={transform.rotation}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onCommit={(rotation) => run('set_transform', { clipId: clip.id, rotation }, 'Rotate clip')}
      />
      <SliderControl
        label={t('editor.opacity')}
        value={clip.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(opacity) => run('set_clip_opacity', { clipId: clip.id, opacity }, 'Clip opacity')}
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant={transform.flipH ? 'primary' : 'secondary'}
          className="flex-1"
          onClick={() => run('set_transform', { clipId: clip.id, flipH: !transform.flipH }, 'Flip clip')}
        >
          <FlipHorizontal size={12} />
        </Button>
        <Button
          size="sm"
          variant={transform.flipV ? 'primary' : 'secondary'}
          className="flex-1"
          onClick={() => run('set_transform', { clipId: clip.id, flipV: !transform.flipV }, 'Flip clip')}
        >
          <FlipVertical size={12} />
        </Button>
      </div>
      {clip.kind === 'video' && (
        <>
          <SliderControl
            label={t('editor.speed')}
            value={clip.speed}
            min={0.25}
            max={4}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onCommit={(speed) => run('set_clip_speed', { clipId: clip.id, speed }, 'Clip speed')}
          />
          <ToggleControl
            label={t('editor.reverse')}
            checked={clip.reversed}
            onChange={(reversed) => run('set_clip_reverse', { clipId: clip.id, reversed }, 'Reverse clip')}
          />
          <ToggleControl
            label={t('editor.freeze')}
            checked={clip.freeze}
            onChange={(freeze) => run('set_freeze_frame', { clipId: clip.id, freeze }, 'Freeze frame')}
          />
        </>
      )}
    </PanelSection>
  );
}

function AudioProperties({ clip, run }: { clip: MediaClip; run: Run }) {
  const { t } = useI18n();
  return (
    <PanelSection title={t('editor.audio')}>
      <SliderControl
        label={t('editor.volume')}
        value={clip.volume}
        min={0}
        max={3}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(volume) => run('set_clip_volume', { clipId: clip.id, volume }, 'Clip volume')}
      />
      <ToggleControl
        label={t('editor.mute')}
        checked={clip.muted}
        onChange={(muted) => run('set_clip_volume', { clipId: clip.id, muted }, 'Mute clip')}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberControl
          label={t('editor.fadeIn')}
          value={clip.fadeIn}
          step={0.1}
          min={0}
          suffix="s"
          onCommit={(fadeIn) => run('set_audio_fade', { clipId: clip.id, fadeIn }, 'Audio fade')}
        />
        <NumberControl
          label={t('editor.fadeOut')}
          value={clip.fadeOut}
          step={0.1}
          min={0}
          suffix="s"
          onCommit={(fadeOut) => run('set_audio_fade', { clipId: clip.id, fadeOut }, 'Audio fade')}
        />
      </div>
    </PanelSection>
  );
}

/**
 * The processing chain the preview and the exporter share: a voice preset built
 * from biquads, a compressor, make-up gain, and ducking under whichever tracks
 * carry speech.
 */
function AudioProcessingSection({ clip, run }: { clip: MediaClip; run: Run }) {
  const { t } = useI18n();
  const tracks = useEditorStore((s) => s.state.tracks);
  const audio = clip.audio;
  const speechTracks = tracks.filter((track) => track.id !== clip.trackId);

  const set = (patch: Record<string, unknown>, label: string) =>
    run('set_audio_processing', { clipIds: [clip.id], ...patch }, label);

  return (
    <PanelSection title={t('editor.audioProcessing')}>
      <Row label={t('editor.audioFilter')}>
        <select
          value={audio.filter}
          onChange={(e) => set({ filter: e.target.value }, 'Voice preset')}
          className="h-7 w-full rounded-sm border border-line bg-base px-1.5 text-[12px] text-ink capitalize transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
        >
          {AUDIO_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {t(`audio.filter.${filter}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
      </Row>
      <SliderControl
        label={t('editor.compression')}
        value={audio.compression}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommit={(compression) => set({ compression }, 'Compression')}
      />
      <SliderControl
        label={t('editor.gain')}
        value={audio.gainDb}
        min={-24}
        max={24}
        step={0.5}
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
        onCommit={(gainDb) => set({ gainDb }, 'Gain')}
      />

      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        onClick={() => run('enhance_voice', { clipIds: [clip.id] }, 'Enhance voice')}
      >
        <Sparkles size={11} /> {t('editor.enhanceVoice')}
      </Button>

      {speechTracks.length > 0 && (
        <>
          <p className="pt-1 text-[10.5px] tracking-wider text-ink-faint uppercase">{t('editor.ducking')}</p>
          <div className="space-y-1">
            {speechTracks.map((track) => {
              const on = audio.duckUnderTrackIds.includes(track.id);
              return (
                <label
                  key={track.id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-[11.5px] text-ink-muted transition-colors hover:bg-elevated"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      set(
                        {
                          duckUnderTrackIds: on
                            ? audio.duckUnderTrackIds.filter((id) => id !== track.id)
                            : [...audio.duckUnderTrackIds, track.id],
                        },
                        'Ducking',
                      )
                    }
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="truncate">{track.name}</span>
                </label>
              );
            })}
          </div>
          {audio.duckUnderTrackIds.length > 0 && (
            <SliderControl
              label={t('editor.duckAmount')}
              value={audio.duckAmount}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `−${Math.round(v * 100)}%`}
              onCommit={(duckAmount) => set({ duckAmount }, 'Duck amount')}
            />
          )}
        </>
      )}
    </PanelSection>
  );
}

function EffectsSection({ clip, run }: { clip: Clip; run: Run }) {
  const { t } = useI18n();
  if (clip.effects.length === 0) return null;
  return (
    <PanelSection title={t('editor.effects')}>
      {clip.effects.map((effect) => {
        const ranges = EFFECT_RANGES[effect.type];
        return (
          <div key={effect.id} className="rounded-sm border border-line bg-base p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] text-ink">{t(`effect.${effect.type}` as DictionaryKey)}</span>
              <div className="flex items-center gap-1">
                <ToggleControl
                  label=""
                  checked={effect.enabled}
                  onChange={(enabled) =>
                    run('update_effect', { clipId: clip.id, effectId: effect.id, enabled }, 'Toggle effect')
                  }
                />
                <button
                  onClick={() => run('remove_effect', { clipId: clip.id, effectId: effect.id }, 'Remove effect')}
                  className="rounded-xs p-1 text-ink-faint transition-colors hover:text-danger"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
            {Object.entries(ranges).map(([param, [min, max]]) => (
              <SliderControl
                key={param}
                label={param}
                value={effect.params[param] ?? min}
                min={min}
                max={max}
                step={(max - min) / 100}
                onCommit={(value) =>
                  run(
                    'update_effect',
                    { clipId: clip.id, effectId: effect.id, params: { [param]: value } },
                    'Adjust effect',
                  )
                }
              />
            ))}
          </div>
        );
      })}
    </PanelSection>
  );
}

function TransitionSection({ clip, run }: { clip: Clip; run: Run }) {
  const { t } = useI18n();
  const types = ['cut', 'fade', 'crossfade', 'dissolve', 'slide', 'zoom', 'wipe'] as const;

  return (
    <PanelSection title={t('editor.transitions')}>
      {(['in', 'out'] as const).map((position) => {
        const transition = position === 'in' ? clip.transitionIn : clip.transitionOut;
        return (
          <div key={position} className="space-y-1.5">
            <Row label={position === 'in' ? t('editor.transitionIn') : t('editor.transitionOut')}>
              <select
                value={transition?.type ?? 'cut'}
                onChange={(e) =>
                  run(
                    'add_transition',
                    { clipId: clip.id, position, type: e.target.value, duration: transition?.duration ?? 0.5 },
                    'Set transition',
                  )
                }
                className="h-7 w-full rounded-sm border border-line bg-base px-1.5 text-[11.5px] text-ink"
              >
                {types.map((type) => (
                  <option key={type} value={type}>
                    {t(`transition.${type}` as DictionaryKey)}
                  </option>
                ))}
              </select>
            </Row>
            {transition && (
              <SliderControl
                label={t('editor.duration')}
                value={transition.duration}
                min={0.05}
                max={Math.max(0.2, clip.duration / 2)}
                step={0.05}
                format={(v) => `${v.toFixed(2)}s`}
                onCommit={(duration) =>
                  run('add_transition', { clipId: clip.id, position, type: transition.type, duration }, 'Transition length')
                }
              />
            )}
          </div>
        );
      })}
    </PanelSection>
  );
}

function KeyframeSection({ clip, run }: { clip: Clip; run: Run }) {
  const { t } = useI18n();
  const properties = [...new Set(clip.keyframes.map((k) => k.property))];
  if (properties.length === 0) {
    return (
      <PanelSection title={t('editor.animation')}>
        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          {t('editor.animationHint')}
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() =>
            run(
              'animate_property',
              { clipId: clip.id, property: 'scale', from: 1, to: 1.12, easing: 'ease_in_out' },
              'Add punch-in',
            )
          }
        >
          <Sparkles size={11} /> Add a slow punch-in
        </Button>
      </PanelSection>
    );
  }

  return (
    <PanelSection title={t('editor.animation')}>
      {properties.map((property) => {
        const frames = clip.keyframes.filter((k) => k.property === property).sort((a, b) => a.time - b.time);
        return (
          <div key={property} className="rounded-sm border border-line bg-base p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11.5px] text-ink">{property}</span>
              <button
                onClick={() => run('clear_keyframes', { clipId: clip.id, property }, 'Clear animation')}
                className="rounded-xs p-1 text-ink-faint transition-colors hover:text-danger"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <div className="space-y-1">
              {frames.map((frame) => (
                <div key={frame.id} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <span className="w-12 font-mono tabular-nums">{frame.time.toFixed(2)}s</span>
                  <input
                    type="number"
                    step={0.01}
                    defaultValue={frame.value}
                    onBlur={(e) =>
                      run(
                        'update_keyframe',
                        { clipId: clip.id, keyframeId: frame.id, value: Number(e.target.value) },
                        'Adjust keyframe',
                      )
                    }
                    className="h-6 w-16 rounded-xs border border-line bg-surface px-1.5 text-[11px] tabular-nums"
                  />
                  <select
                    defaultValue={frame.easing}
                    onChange={(e) =>
                      run(
                        'update_keyframe',
                        { clipId: clip.id, keyframeId: frame.id, easing: e.target.value },
                        'Keyframe easing',
                      )
                    }
                    className="h-6 min-w-0 flex-1 rounded-xs border border-line bg-surface px-1 text-[10.5px]"
                  >
                    {EASINGS.map((easing) => (
                      <option key={easing} value={easing}>
                        {easing.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </PanelSection>
  );
}
