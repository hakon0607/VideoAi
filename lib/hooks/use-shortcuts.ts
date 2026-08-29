'use client';

import { useEffect } from 'react';

export interface ShortcutHandlers {
  onPlayPause: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDelete: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onNudge: (frames: number) => void;
  onZoom: (direction: 1 | -1) => void;
  onToggleSelectTool: () => void;
  onEscape: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** The editor keyboard map. Typing in a field always wins. */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur();
        return;
      }
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) handlers.onRedo();
        else handlers.onUndo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handlers.onRedo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handlers.onSave();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        handlers.onDuplicate();
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        handlers.onZoom(1);
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        handlers.onZoom(-1);
        return;
      }
      if (mod) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          handlers.onPlayPause();
          break;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          handlers.onDelete();
          break;
        case 's':
        case 'S':
          event.preventDefault();
          handlers.onSplit();
          break;
        case 'v':
        case 'V':
          handlers.onToggleSelectTool();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          handlers.onNudge(event.shiftKey ? -10 : -1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          handlers.onNudge(event.shiftKey ? 10 : 1);
          break;
        case 'Escape':
          handlers.onEscape();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}

export const SHORTCUT_HINTS = [
  { keys: 'Space', action: 'Play / pause' },
  { keys: 'S', action: 'Split at playhead' },
  { keys: 'V', action: 'Selection tool' },
  { keys: 'Delete', action: 'Delete selection' },
  { keys: '⌘/Ctrl + Z', action: 'Undo' },
  { keys: '⌘/Ctrl + ⇧ + Z', action: 'Redo' },
  { keys: '⌘/Ctrl + S', action: 'Save' },
  { keys: '⌘/Ctrl + D', action: 'Duplicate clip' },
  { keys: '← / →', action: 'Nudge one frame' },
  { keys: '⇧ + ← / →', action: 'Nudge ten frames' },
  { keys: '⌘/Ctrl + + / −', action: 'Zoom timeline' },
];
