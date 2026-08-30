import 'server-only';
import OpenAI from 'openai';

/**
 * Which AI answers the assistant.
 *
 * Every provider here speaks the OpenAI chat-completions shape, including tool
 * calling, so the whole editor-command layer is untouched by the choice — only
 * a base URL, a key and a model name change. That matters because running this
 * on a paid API is what makes a hobby project expensive: the assistant is
 * called on every request, and a long timeline is a lot of tokens.
 *
 * The default is Google's Gemini free tier: no card, a real daily allowance,
 * and function calling on the OpenAI-compatible endpoint. Groq is the other
 * good free option and is also what transcription uses.
 */
export type AiProvider = 'gemini' | 'groq' | 'openrouter' | 'openai' | 'ollama';

interface ProviderSpec {
  label: string;
  baseUrl: string;
  /** Environment variables checked for a key, in order. */
  keyVars: string[];
  /** Tried in order until one answers; the winner is remembered. */
  models: string[];
  /** Where to get a key, shown in the error when one is missing. */
  keyUrl: string;
  /** Ollama runs on the same machine and needs no key. */
  keyOptional?: boolean;
}

const PROVIDERS: Record<AiProvider, ProviderSpec> = {
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyVars: ['AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyVars: ['AI_API_KEY', 'GROQ_API_KEY'],
    models: [
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.1-8b-instant',
    ],
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyVars: ['AI_API_KEY', 'OPENROUTER_API_KEY'],
    models: ['google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    keyUrl: 'https://openrouter.ai/keys',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyVars: ['AI_API_KEY', 'OPENAI_API_KEY'],
    models: ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    keyVars: ['AI_API_KEY'],
    models: ['llama3.1', 'qwen2.5'],
    keyUrl: 'https://ollama.com',
    keyOptional: true,
  },
};

function isProvider(value: string | undefined): value is AiProvider {
  return value === 'gemini' || value === 'groq' || value === 'openrouter' || value === 'openai' || value === 'ollama';
}

export function aiProvider(): AiProvider {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (isProvider(configured)) return configured;
  // No explicit choice: use whichever key is present, preferring the free ones.
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'gemini';
}

export function providerLabel(provider: AiProvider = aiProvider()): string {
  return PROVIDERS[provider].label;
}

let workingChatModel: string | null = null;
let workingTranscribeModel: string | null = null;

export class OpenAIConfigError extends Error {
  readonly code = 'openai_not_configured';
}

export function getOpenAI(): OpenAI {
  const provider = aiProvider();
  const spec = PROVIDERS[provider];
  const apiKey = spec.keyVars.map((name) => process.env[name]?.trim()).find(Boolean);

  if (!apiKey && !spec.keyOptional) {
    throw new OpenAIConfigError(
      `No API key for ${spec.label}. Add AI_API_KEY (or ${spec.keyVars[1] ?? 'the provider key'}) to the environment — a free key takes a minute at ${spec.keyUrl}.`,
    );
  }

  return new OpenAI({
    apiKey: apiKey ?? 'not-needed',
    baseURL: process.env.AI_BASE_URL?.trim() || spec.baseUrl,
    maxRetries: 1,
  });
}

export function chatModelCandidates(): string[] {
  const spec = PROVIDERS[aiProvider()];
  const pinned = (process.env.AI_MODEL ?? process.env.OPENAI_MODEL)?.trim();
  const chain = pinned ? [pinned, ...spec.models] : spec.models;
  return [...new Set(workingChatModel ? [workingChatModel, ...chain] : chain)];
}

export function rememberChatModel(model: string): void {
  workingChatModel = model;
}

/* -------------------------------------------------------------------------- */
/* Transcription                                                              */
/* -------------------------------------------------------------------------- */

export type TranscribeProvider = 'groq' | 'openai' | 'none';

const TRANSCRIBE_SPECS: Record<'groq' | 'openai', ProviderSpec> = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyVars: ['TRANSCRIBE_API_KEY', 'GROQ_API_KEY', 'AI_API_KEY'],
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    keyUrl: 'https://console.groq.com/keys',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyVars: ['TRANSCRIBE_API_KEY', 'OPENAI_API_KEY'],
    models: ['whisper-1', 'gpt-4o-transcribe'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
};

/**
 * Whisper on Groq's free tier is the default: it is genuinely free, it is fast,
 * and it returns word-level timestamps, which is what caption timing needs.
 */
export function transcribeProvider(): TranscribeProvider {
  const configured = process.env.TRANSCRIBE_PROVIDER?.trim().toLowerCase();
  if (configured === 'groq' || configured === 'openai' || configured === 'none') return configured;
  if (process.env.GROQ_API_KEY || process.env.TRANSCRIBE_API_KEY) return 'groq';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'groq';
}

export function getTranscriber(): OpenAI {
  const provider = transcribeProvider();
  if (provider === 'none') {
    throw new OpenAIConfigError('Transcription is turned off (TRANSCRIBE_PROVIDER=none).');
  }
  const spec = TRANSCRIBE_SPECS[provider];
  const apiKey = spec.keyVars.map((name) => process.env[name]?.trim()).find(Boolean);
  if (!apiKey) {
    throw new OpenAIConfigError(
      `No API key for transcription with ${spec.label}. Add GROQ_API_KEY — it is free and takes a minute at ${spec.keyUrl}.`,
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.TRANSCRIBE_BASE_URL?.trim() || spec.baseUrl,
    maxRetries: 1,
  });
}

export function transcribeModelCandidates(): string[] {
  const provider = transcribeProvider();
  const spec = provider === 'none' ? TRANSCRIBE_SPECS.groq : TRANSCRIBE_SPECS[provider];
  const pinned = (process.env.TRANSCRIBE_MODEL ?? process.env.OPENAI_TRANSCRIBE_MODEL)?.trim();
  const chain = pinned ? [pinned, ...spec.models] : spec.models;
  return [...new Set(workingTranscribeModel ? [workingTranscribeModel, ...chain] : chain)];
}

export function rememberTranscribeModel(model: string): void {
  workingTranscribeModel = model;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

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
        message.includes('decommissioned') ||
        message.includes('unsupported'))
    );
  }
  return false;
}

/** Turns a provider failure into something worth showing a user. */
export function describeOpenAIError(error: unknown): { status: number; code: string; message: string } {
  const label = providerLabel();

  if (error instanceof OpenAIConfigError) {
    return { status: 503, code: error.code, message: error.message };
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) {
      return {
        status: 502,
        code: 'openai_unauthorized',
        message: `${label} rejected the API key. Check that it is current and pasted in full.`,
      };
    }
    if (error.status === 429) {
      const message = String(error.message ?? '').toLowerCase();
      return message.includes('quota') || message.includes('billing')
        ? {
            status: 502,
            code: 'openai_quota',
            message: `The ${label} account is out of quota.`,
          }
        : {
            status: 503,
            code: 'openai_busy',
            message: `${label}'s free tier is rate limiting right now. Wait a moment and try again.`,
          };
    }
    return { status: 502, code: 'openai_error', message: `${label}: ${error.message || 'the provider returned an error.'}` };
  }
  if (error instanceof Error && /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(error.message)) {
    return {
      status: 503,
      code: 'openai_unreachable',
      message: `Could not reach ${label}. Check AI_BASE_URL and that the service is up.`,
    };
  }
  return {
    status: 500,
    code: 'unexpected_error',
    message: error instanceof Error ? error.message : 'Unexpected error.',
  };
}
