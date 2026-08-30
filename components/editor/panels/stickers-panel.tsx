'use client';

import { useCallback, useState } from 'react';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { cn } from '@/lib/utils/cn';
import type { DictionaryKey } from '@/lib/i18n/dictionaries';
import { Row, SliderControl } from './controls';

const STICKER_GROUPS: { id: string; label: string; emoji: string[] }[] = [
  {
    id: 'reactions',
    label: '😀',
    emoji: ['😂', '😅', '🤣', '😍', '🥹', '😭', '😱', '🤯', '😳', '🙃', '😎', '🤔', '😴', '🤤', '🥳', '😤', '🫠', '🫡', '🤪', '😬'],
  },
  {
    id: 'hands',
    label: '👍',
    emoji: ['👍', '👎', '👏', '🙌', '🤝', '💪', '👌', '🤌', '✌️', '🫶', '🤞', '👀', '🧠', '💅', '🙏', '👋'],
  },
  {
    id: 'food',
    label: '🍰',
    emoji: ['🍰', '🧁', '🍪', '🥐', '🍞', '🥖', '🎂', '🍫', '🍓', '🥚', '🧈', '🥣', '🍯', '🧑‍🍳', '🔥', '⏲️'],
  },
  {
    id: 'symbols',
    label: '✨',
    emoji: ['✨', '💥', '⭐', '❤️', '💯', '🔥', '⚡', '🎉', '🎊', '❗', '❓', '💤', '💫', '🌈', '🏆', '🥇'],
  },
  {
    id: 'arrows',
    label: '➡️',
    emoji: ['➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '🔄', '🔁', '▶️', '⏸️', '⏭️', '🔔', '📌', '🚨', '⚠️', '🎯'],
  },
];

const ANIMATIONS = ['pop', 'bounce', 'shake', 'zoom_in', 'fade', 'none'] as const;

/** CapCut-style sticker tray: pick an emoji, it lands at the playhead. */
export function StickersPanel() {
  const { t } = useI18n();
  const [group, setGroup] = useState(STICKER_GROUPS[0].id);
  const [size, setSize] = useState(0.16);
  const [duration, setDuration] = useState(2.5);
  const [animation, setAnimation] = useState<(typeof ANIMATIONS)[number]>('pop');
  const dispatch = useEditorStore((s) => s.dispatch);

  const add = useCallback(
    (emoji: string) => {
      const store = useEditorStore.getState();
      dispatch(
        [
          {
            type: 'add_sticker',
            params: { emoji, start: store.playhead, duration, size, animation, y: -0.25 },
          },
        ],
        { label: `Add ${emoji}` },
      );
    },
    [animation, dispatch, duration, size],
  );

  const active = STICKER_GROUPS.find((g) => g.id === group) ?? STICKER_GROUPS[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-line px-3 py-2">
        {STICKER_GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroup(g.id)}
            className={cn(
              'h-7 w-7 rounded-sm text-[14px] transition-colors',
              group === g.id ? 'bg-elevated' : 'opacity-60 hover:opacity-100',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-[11px] text-ink-faint">{t('editor.stickersHint')}</p>
        <div className="grid grid-cols-6 gap-1">
          {active.emoji.map((emoji) => (
            <button
              key={emoji}
              onClick={() => add(emoji)}
              title={t('editor.addAtPlayhead')}
              className="grid aspect-square place-items-center rounded-sm border border-transparent text-[20px] transition-colors hover:border-line hover:bg-elevated"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 space-y-2.5 border-t border-line px-3 py-3">
        <SliderControl
          label={t('editor.size')}
          value={size}
          min={0.04}
          max={0.6}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onCommit={setSize}
        />
        <SliderControl
          label={t('editor.duration')}
          value={duration}
          min={0.3}
          max={15}
          step={0.1}
          format={(v) => `${v.toFixed(1)}s`}
          onCommit={setDuration}
        />
        <Row label={t('editor.animation')}>
          <select
            value={animation}
            onChange={(e) => setAnimation(e.target.value as (typeof ANIMATIONS)[number])}
            className="h-7 w-full rounded-sm border border-line bg-base px-1.5 text-[12px] text-ink capitalize transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
          >
            {ANIMATIONS.map((id) => (
              <option key={id} value={id}>
                {t(`animation.${id}` as DictionaryKey)}
              </option>
            ))}
          </select>
        </Row>
      </div>
    </div>
  );
}
