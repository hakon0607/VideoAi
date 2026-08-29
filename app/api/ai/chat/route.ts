import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { describeOpenAIError } from '@/lib/openai/client';
import { runAssistant, type AiEvent } from '@/lib/ai/run';
import { parseEditorState } from '@/lib/ai/state-schema';
import type { Json } from '@/types/database';

export const runtime = 'nodejs';
export const maxDuration = 300;

const bodySchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(4000),
  state: z.unknown(),
  selection: z.array(z.string()).max(500).default([]),
  playhead: z.number().min(0).default(0),
  locale: z.enum(['en', 'nb']).default('en'),
  conversationId: z.string().uuid().nullable().default(null),
  allowDestructive: z.boolean().default(false),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(24)
    .default([]),
});

function line(event: AiEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: 'invalid_request', message: error instanceof Error ? error.message : 'Bad request body.' },
      { status: 400 },
    );
  }

  let state;
  try {
    state = parseEditorState(body.state);
  } catch {
    return NextResponse.json({ error: 'invalid_state', message: 'The editor snapshot was malformed.' }, { status: 400 });
  }
  if (state.projectId !== body.projectId) {
    return NextResponse.json({ error: 'project_mismatch' }, { status: 400 });
  }

  // Authorisation is checked against the database, never against the snapshot.
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', body.projectId)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  // --- credits -------------------------------------------------------------
  const reason = 'ai_command';
  const { data: charge, error: chargeError } = await supabase.rpc('consume_credits', {
    p_reason: reason,
    p_project_id: body.projectId,
  });
  if (chargeError) {
    if (chargeError.message.includes('insufficient_credits')) {
      let detail: unknown = null;
      try {
        detail = JSON.parse(chargeError.details ?? 'null');
      } catch {
        detail = null;
      }
      return NextResponse.json({ error: 'insufficient_credits', detail }, { status: 402 });
    }
    return NextResponse.json({ error: 'credit_error', message: chargeError.message }, { status: 500 });
  }
  const charged = Number((charge as { charged?: number } | null)?.charged ?? 0);

  // --- conversation --------------------------------------------------------
  let conversationId = body.conversationId;
  if (!conversationId) {
    const { data: created } = await supabase
      .from('ai_conversations')
      .insert({ project_id: body.projectId, user_id: auth.user.id })
      .select('id')
      .single();
    conversationId = created?.id ?? null;
  }
  if (conversationId) {
    await supabase.from('ai_messages').insert({
      conversation_id: conversationId,
      project_id: body.projectId,
      user_id: auth.user.id,
      role: 'user',
      content: body.prompt,
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const refund = async () => {
        if (charged > 0) {
          await supabase.rpc('refund_credits', {
            p_reason: reason,
            p_amount: charged,
            p_project_id: body.projectId,
          });
        }
      };

      try {
        controller.enqueue(line({ type: 'status', step: 'analyzing' }));
        let finished = false;

        for await (const event of runAssistant({
          state,
          selection: body.selection,
          playhead: body.playhead,
          locale: body.locale,
          history: body.history,
          prompt: body.prompt,
          allowDestructive: body.allowDestructive,
        })) {
          controller.enqueue(line(event));

          if (event.type === 'done') {
            finished = true;
            if (conversationId) {
              await supabase.from('ai_messages').insert({
                conversation_id: conversationId,
                project_id: body.projectId,
                user_id: auth.user.id,
                role: 'assistant',
                content: event.message,
                actions: event.actions as unknown as Json,
                descriptions: event.descriptions as unknown as Json,
                model: event.model,
                prompt_tokens: event.usage.prompt,
                completion_tokens: event.usage.completion,
                credits_charged: charged,
                status: 'complete',
              });
            }
            if (event.actions.length > 0) {
              await supabase.from('editor_history').insert({
                project_id: body.projectId,
                user_id: auth.user.id,
                timeline_id: state.timelineId,
                label: body.prompt.slice(0, 160),
                source: 'ai',
                actions: event.actions as unknown as Json,
                descriptions: event.descriptions as unknown as Json,
              });
            } else {
              // Nothing was edited, so bill the cheaper question price instead.
              await refund();
              await supabase.rpc('consume_credits', {
                p_reason: 'ai_question',
                p_project_id: body.projectId,
              });
            }
          }
        }

        if (!finished) {
          await refund();
          controller.enqueue(line({ type: 'error', code: 'no_response', message: 'The assistant produced no answer.' }));
        }
      } catch (error) {
        await refund();
        const described = describeOpenAIError(error);
        if (conversationId) {
          await supabase.from('ai_messages').insert({
            conversation_id: conversationId,
            project_id: body.projectId,
            user_id: auth.user.id,
            role: 'assistant',
            content: '',
            status: 'failed',
            error: described.message,
            credits_charged: 0,
          });
        }
        controller.enqueue(line({ type: 'error', code: described.code, message: described.message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Conversation-Id': conversationId ?? '',
    },
  });
}
