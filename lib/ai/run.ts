import 'server-only';
import { z } from 'zod';
import type OpenAI from 'openai';
import type { EditorState } from '@/types/editor';
import type { EditorAction } from '@/lib/editor/action-kit';
import { aiExposedActions, applyAction } from '@/lib/editor/engine';
import { EditorError } from '@/lib/editor/errors';
import { newId } from '@/lib/editor/ids';
import {
  chatModelCandidates,
  getOpenAI,
  isModelUnavailable,
  rememberChatModel,
} from '@/lib/openai/client';
import { READ_TOOL_MAP, READ_TOOLS } from './read-tools';
import { buildProjectContext } from './project-context';
import { buildSystemPrompt } from './system-prompt';

const MAX_ITERATIONS = 14;
const MAX_ACTIONS = 400;

export type AiEvent =
  | { type: 'status'; step: 'analyzing' | 'planning' | 'applying'; detail?: string }
  | { type: 'tool'; name: string; ok: boolean; description?: string; error?: string }
  | { type: 'confirm'; actions: EditorAction[]; reason: string }
  | { type: 'done'; message: string; actions: EditorAction[]; descriptions: string[]; model: string; usage: { prompt: number; completion: number } }
  | { type: 'error'; code: string; message: string };

export interface RunOptions {
  state: EditorState;
  selection: string[];
  playhead: number;
  locale: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  prompt: string;
  /** Set when the user has already approved a destructive step. */
  allowDestructive?: boolean;
}

interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete generated.$schema;
  // OpenAI rejects unknown top-level keywords on some models.
  return { type: 'object', properties: {}, ...generated };
}

let cachedTools: ToolSpec[] | null = null;

/**
 * The model's toolbox: every read tool, plus every editor command in the
 * registry. Adding an action to the registry exposes it here automatically —
 * that is the whole point of the "AI controls the same editor" design.
 */
export function buildTools(): ToolSpec[] {
  if (cachedTools) return cachedTools;
  const tools: ToolSpec[] = READ_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: jsonSchemaFor(tool.schema) },
  }));

  for (const action of aiExposedActions()) {
    tools.push({
      type: 'function',
      function: {
        name: action.type,
        description: action.destructive ? `${action.summary} (destructive: needs user confirmation)` : action.summary,
        parameters: jsonSchemaFor(action.schema),
      },
    });
  }
  cachedTools = tools;
  return tools;
}

function toolResult(value: unknown): string {
  const json = JSON.stringify(value);
  // Keep a single tool result from blowing the context window.
  return json.length > 24000 ? `${json.slice(0, 24000)}…(truncated)` : json;
}

/**
 * Runs one assistant turn.
 *
 * The model proposes tool calls; every editing call is validated by the action
 * schema and executed against a working copy of the project here on the server.
 * The client then replays the validated command list through the exact same
 * engine, which is what makes the whole turn one undo step.
 */
export async function* runAssistant(options: RunOptions): AsyncGenerator<AiEvent> {
  const openai = getOpenAI();
  const tools = buildTools();

  let working = options.state;
  const appliedActions: EditorAction[] = [];
  const descriptions: string[] = [];
  const usage = { prompt: 0, completion: 0 };

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(options.state, options.locale) },
    {
      role: 'system',
      content: `Current project state:\n${toolResult(buildProjectContext(options.state, options.selection, options.playhead))}`,
    },
    ...options.history.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
    { role: 'user', content: options.prompt },
  ];

  yield { type: 'status', step: 'analyzing' };

  let model = '';
  let finalMessage = '';

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let completion: OpenAI.Chat.Completions.ChatCompletion | null = null;
    let lastError: unknown = null;

    for (const candidate of chatModelCandidates()) {
      try {
        completion = await openai.chat.completions.create({
          model: candidate,
          messages,
          tools,
          tool_choice: 'auto',
          parallel_tool_calls: false,
        });
        model = candidate;
        rememberChatModel(candidate);
        break;
      } catch (error) {
        lastError = error;
        if (!isModelUnavailable(error)) throw error;
      }
    }
    if (!completion) throw lastError ?? new Error('No usable OpenAI model was found.');

    usage.prompt += completion.usage?.prompt_tokens ?? 0;
    usage.completion += completion.usage?.completion_tokens ?? 0;

    const choice = completion.choices[0];
    const message = choice.message;
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      finalMessage = message.content ?? '';
      break;
    }

    if (iteration === 0) yield { type: 'status', step: 'planning' };

    for (const call of calls) {
      if (call.type !== 'function') continue;
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
      } catch {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult({ error: 'invalid_json', message: 'The arguments were not valid JSON.' }),
        });
        continue;
      }

      // --- read tools -----------------------------------------------------
      const readTool = READ_TOOL_MAP.get(name);
      if (readTool) {
        try {
          const parsed = readTool.schema.parse(args);
          const value = readTool.run(parsed as never, {
            state: working,
            selection: options.selection,
            playhead: options.playhead,
          });
          yield { type: 'tool', name, ok: true };
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult(value) });
        } catch (error) {
          const payload =
            error instanceof EditorError
              ? error.toJSON()
              : { error: 'invalid_parameters', message: error instanceof Error ? error.message : String(error) };
          yield { type: 'tool', name, ok: false, error: String(payload.message ?? '') };
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult(payload) });
        }
        continue;
      }

      // --- editor commands -------------------------------------------------
      if (appliedActions.length >= MAX_ACTIONS) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult({ error: 'limit_exceeded', message: 'Too many edits in one request. Summarise and stop.' }),
        });
        continue;
      }

      const action: EditorAction = { type: name, params: args };
      const destructive = aiExposedActions().find((a) => a.type === name)?.destructive;
      if (destructive && !options.allowDestructive) {
        yield { type: 'confirm', actions: [action], reason: `${name} permanently removes data.` };
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult({
            status: 'awaiting_confirmation',
            message: 'This action needs the user to confirm it. Explain what it will do and stop.',
          }),
        });
        continue;
      }

      if (iteration >= 0 && appliedActions.length === 0) yield { type: 'status', step: 'applying' };

      try {
        const result = applyAction(working, action, { newId });
        working = result.state;
        appliedActions.push(result.applied.action);
        descriptions.push(result.applied.description);
        yield { type: 'tool', name, ok: true, description: result.applied.description };
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult({ ok: true, applied: result.applied.description, params: result.applied.action.params }),
        });
      } catch (error) {
        const payload =
          error instanceof EditorError
            ? error.toJSON()
            : { error: 'invalid_parameters', message: error instanceof Error ? error.message : String(error) };
        yield { type: 'tool', name, ok: false, error: String(payload.message ?? '') };
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult(payload) });
      }
    }
  }

  if (!finalMessage) {
    finalMessage = descriptions.length
      ? descriptions.join('. ')
      : 'I could not complete that. Try rephrasing, or tell me which clip you mean.';
  }

  yield {
    type: 'done',
    message: finalMessage,
    actions: appliedActions,
    descriptions,
    model,
    usage,
  };
}
