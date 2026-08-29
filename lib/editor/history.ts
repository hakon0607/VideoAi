import type { EditorState } from '@/types/editor';
import type { EditorAction } from './action-kit';

export type ChangeSource = 'user' | 'ai' | 'system';

export interface HistoryEntry {
  id: string;
  /** What the user sees in the history list, e.g. "AI: make it more energetic". */
  label: string;
  source: ChangeSource;
  /** The exact commands that produced `after` from `before`. */
  actions: EditorAction[];
  descriptions: string[];
  before: EditorState;
  after: EditorState;
  at: string;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const MAX_HISTORY = 200;

export function emptyHistory(): History {
  return { past: [], future: [] };
}

/**
 * Pushes one transaction. Because the reducers are immutable and share
 * structure, keeping both snapshots costs almost nothing: only the objects that
 * actually changed are duplicated.
 */
export function pushEntry(history: History, entry: HistoryEntry): History {
  const past = [...history.past, entry];
  return { past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past, future: [] };
}

export function undo(history: History): { history: History; entry: HistoryEntry } | null {
  if (history.past.length === 0) return null;
  const entry = history.past[history.past.length - 1];
  return {
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
    entry,
  };
}

export function redo(history: History): { history: History; entry: HistoryEntry } | null {
  if (history.future.length === 0) return null;
  const entry = history.future[0];
  return {
    history: { past: [...history.past, entry], future: history.future.slice(1) },
    entry,
  };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}
