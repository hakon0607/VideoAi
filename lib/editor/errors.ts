/**
 * Structured editor errors.
 *
 * Every failure the command engine can produce has a stable machine code. The
 * AI layer feeds these codes straight back to the model as a tool result, so it
 * can recover ("clip_not_found" -> re-inspect the timeline and try again)
 * instead of the request simply failing.
 */

export const EDITOR_ERROR_CODES = [
  'clip_not_found',
  'track_not_found',
  'asset_not_found',
  'effect_not_found',
  'keyframe_not_found',
  'transition_not_found',
  'invalid_parameters',
  'invalid_time',
  'invalid_range',
  'clip_locked',
  'track_locked',
  'incompatible_track',
  'duplicate_id',
  'nothing_to_do',
  'unsupported_action',
  'limit_exceeded',
] as const;

export type EditorErrorCode = (typeof EDITOR_ERROR_CODES)[number];

export class EditorError extends Error {
  readonly code: EditorErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: EditorErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EditorError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { error: this.code, message: this.message, details: this.details };
  }
}

export function isEditorError(value: unknown): value is EditorError {
  return value instanceof EditorError;
}
