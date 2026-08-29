import 'server-only';
import OpenAI from 'openai';

/**
 * Model names come and go. Rather than pinning one and breaking the day it is
 * retired, the app walks a chain and remembers the first one that answers.
 * Set OPENAI_MODEL to override.
 */
const CHAT_FALLBACKS = ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o'];
const TRANSCRIBE_FALLBACKS = ['whisper-1', 'gpt-4o-transcribe'];

let workingChatModel: string | null = null;
let workingTranscribeModel: string | null = null;

export function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAIConfigError('OPENAI_API_KEY is not set. Add it in your environment before using the assistant.');
  }
  return new OpenAI({ apiKey, maxRetries: 1 });
}

export class OpenAIConfigError extends Error {
  readonly code = 'openai_not_configured';
}

export function chatModelCandidates(): string[] {
  const pinned = process.env.OPENAI_MODEL?.trim();
  const chain = pinned ? [pinned, ...CHAT_FALLBACKS] : CHAT_FALLBACKS;
  const preferred = workingChatModel ? [workingChatModel, ...chain] : chain;
  return [...new Set(preferred)];
}

export function transcribeModelCandidates(): string[] {
  const pinned = process.env.OPENAI_TRANSCRIBE_MODEL?.trim();
  const chain = pinned ? [pinned, ...TRANSCRIBE_FALLBACKS] : TRANSCRIBE_FALLBACKS;
  const preferred = workingTranscribeModel ? [workingTranscribeModel, ...chain] : chain;
  return [...new Set(preferred)];
}

export function rememberChatModel(model: string): void {
  workingChatModel = model;
}

export function rememberTranscribeModel(model: string): void {
  workingTranscribeModel = model;
}

/** True when the error means "that model does not exist here", not a real failure. */
export function isModelUnavailable(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (error.status === 404) return true;
  if (error.status === 400 || error.status === 403) {
    const message = String(error.message ?? '').toLowerCase();
    return (
      message.includes('model') &&
      (message.includes('does not exist') ||
        message.includes('not found') ||
        message.includes('do not have access') ||
        message.includes('unsupported'))
    );
  }
  return false;
}

/** Turns an OpenAI failure into something worth showing a user. */
export function describeOpenAIError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof OpenAIConfigError) {
    return { status: 503, code: error.code, message: error.message };
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) {
      return { status: 502, code: 'openai_unauthorized', message: 'The OpenAI API key was rejected.' };
    }
    if (error.status === 429) {
      const message = String(error.message ?? '').toLowerCase();
      return message.includes('quota')
        ? { status: 502, code: 'openai_quota', message: 'The OpenAI account is out of quota.' }
        : { status: 503, code: 'openai_busy', message: 'OpenAI is rate limiting right now. Try again in a moment.' };
    }
    return {
      status: 502,
      code: 'openai_error',
      message: error.message || 'OpenAI returned an error.',
    };
  }
  return {
    status: 500,
    code: 'unexpected_error',
    message: error instanceof Error ? error.message : 'Unexpected error.',
  };
}
