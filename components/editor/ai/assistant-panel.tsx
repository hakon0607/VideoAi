'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUp, Check, History, Loader2, Sparkles, Trash2, Undo2 } from 'lucide-react';
import type { EditorAction } from '@/lib/editor/action-kit';
import { useEditorStore } from '@/lib/editor/store';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';
import type { AiMessageDto } from '@/lib/actions/editor-data';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

type Step = 'analyzing' | 'planning' | 'applying';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  descriptions: string[];
  entryId?: string;
  failed?: boolean;
  partial?: number;
}

interface PendingConfirm {
  actions: EditorAction[];
  reason: string;
  prompt: string;
}

const STEP_KEYS = {
  analyzing: 'ai.step.analyzing',
  planning: 'ai.step.planning',
  applying: 'ai.step.applying',
} as const;

export function AssistantPanel({
  projectId,
  conversationId: initialConversationId,
  initialMessages,
}: {
  projectId: string;
  conversationId: string | null;
  initialMessages: AiMessageDto[];
}) {
  const { t, locale } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        descriptions: m.descriptions,
        failed: m.status === 'failed',
      })),
  );
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<{ step: Step; done: boolean }[]>([]);
  const [toolLog, setToolLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [clearing, setClearing] = useState(false);

  const dispatch = useEditorStore((s) => s.dispatch);
  const undo = useEditorStore((s) => s.undo);
  const setAiBusy = useEditorStore((s) => s.setAiBusy);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, toolLog, busy]);

  const send = useCallback(
    async (prompt: string, allowDestructive = false) => {
      const trimmed = prompt.trim();
      if (!trimmed || busy) return;

      setBusy(true);
      setAiBusy(true);
      setError(null);
      setConfirm(null);
      setSteps([]);
      setToolLog([]);
      setMessages((m) => [...m, { id: `local-${Date.now()}`, role: 'user', content: trimmed, descriptions: [] }]);
      setInput('');

      const store = useEditorStore.getState();
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));

      try {
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            prompt: trimmed,
            state: store.state,
            selection: store.selection.clipIds,
            playhead: store.playhead,
            locale,
            conversationId,
            allowDestructive,
            history,
          }),
        });

        const headerConversation = response.headers.get('X-Conversation-Id');
        if (headerConversation) setConversationId(headerConversation);

        if (response.status === 402) {
          const body = await response.json().catch(() => ({}));
          const detail = body.detail as { balance?: number; required?: number } | null;
          setError(
            detail
              ? `${t('credits.empty.title')} — ${detail.balance ?? 0}/${detail.required ?? 0}`
              : t('credits.empty.title'),
          );
          return;
        }
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          setError(body.message ?? t('ai.failed'));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let pendingConfirm: PendingConfirm | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            if (!raw.trim()) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw);
            } catch {
              continue;
            }

            if (event.type === 'status') {
              const step = event.step as Step;
              setSteps((s) => [...s.map((entry) => ({ ...entry, done: true })), { step, done: false }]);
            } else if (event.type === 'tool') {
              if (event.description) setToolLog((log) => [...log, String(event.description)]);
              else if (event.ok === false && event.error) setToolLog((log) => [...log, `⚠ ${String(event.error)}`]);
            } else if (event.type === 'confirm') {
              pendingConfirm = {
                actions: event.actions as EditorAction[],
                reason: String(event.reason ?? ''),
                prompt: trimmed,
              };
            } else if (event.type === 'error') {
              setError(String(event.message ?? t('ai.failed')));
            } else if (event.type === 'done') {
              const actions = (event.actions as EditorAction[]) ?? [];
              const descriptions = (event.descriptions as string[]) ?? [];
              let entryId: string | undefined;
              let partial = 0;

              if (actions.length > 0) {
                // The whole assistant turn is replayed through the same engine
                // the UI uses, so it lands as exactly one undo step.
                const result = dispatch(actions, {
                  label: trimmed.slice(0, 80),
                  source: 'ai',
                  lenient: true,
                });
                entryId = result.entryId;
                partial = result.failures?.length ?? 0;
              }

              setSteps((s) => s.map((entry) => ({ ...entry, done: true })));
              setMessages((m) => [
                ...m,
                {
                  id: `local-${Date.now()}-a`,
                  role: 'assistant',
                  content: String(event.message ?? ''),
                  descriptions,
                  entryId,
                  partial,
                },
              ]);
            }
          }
        }

        if (pendingConfirm) setConfirm(pendingConfirm);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : t('ai.failed'));
      } finally {
        setBusy(false);
        setAiBusy(false);
        setToolLog([]);
        setSteps([]);
      }
    },
    [busy, conversationId, dispatch, locale, messages, projectId, setAiBusy, t],
  );

  const clearConversation = useCallback(async () => {
    if (!window.confirm(t('ai.clearChat'))) return;
    setClearing(true);
    try {
      if (conversationId) {
        const supabase = createClient();
        await supabase.from('ai_conversations').delete().eq('id', conversationId);
      }
      setMessages([]);
      setConversationId(null);
      setError(null);
    } finally {
      setClearing(false);
    }
  }, [conversationId, t]);

  const allChanges = messages.filter((m) => m.role === 'assistant' && m.descriptions.length > 0);

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-surface">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          <Sparkles size={13} className="text-accent" />
          {t('ai.title')}
        </span>
        <span className="flex items-center gap-0.5">
        <button
          onClick={() => void clearConversation()}
          disabled={busy || clearing || messages.length === 0}
          className="grid h-7 w-7 place-items-center rounded-sm text-ink-faint transition-colors hover:bg-elevated hover:text-danger disabled:opacity-30"
          title={t('ai.clearChat')}
        >
          <Trash2 size={13} />
        </button>
        <button
          onClick={() => setShowChanges((v) => !v)}
          className={cn(
            'grid h-7 w-7 place-items-center rounded-sm transition-colors hover:bg-elevated hover:text-ink',
            showChanges ? 'bg-elevated text-ink' : 'text-ink-faint',
          )}
          title={t('ai.changes')}
        >
          <History size={13} />
        </button>
        </span>
      </header>

      {showChanges ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <h3 className="mb-2 text-[10.5px] font-medium tracking-wider text-ink-faint uppercase">
            {t('ai.changes')}
          </h3>
          {allChanges.length === 0 ? (
            <p className="text-[12px] text-ink-faint">{t('ai.noChanges')}</p>
          ) : (
            <ol className="space-y-2.5">
              {allChanges.map((message) => (
                <li key={message.id} className="rounded-md border border-line bg-base p-2.5">
                  <ul className="space-y-1">
                    {message.descriptions.map((description, i) => (
                      <li key={i} className="flex gap-1.5 text-[11.5px] text-ink-muted">
                        <Check size={11} className="mt-0.5 shrink-0 text-positive" />
                        <span>{description}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 && !busy && (
            <div className="mt-6 text-center">
              <p className="text-[13px] font-medium text-ink">{t('ai.empty.title')}</p>
              <p className="mx-auto mt-1 max-w-56 text-[12px] leading-relaxed text-ink-muted">{t('ai.empty.body')}</p>
              <div className="mt-4 space-y-1.5">
                {(['ai.example.1', 'ai.example.2', 'ai.example.3', 'ai.example.4'] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => void send(t(key))}
                    className="w-full rounded-md border border-line bg-base px-3 py-2 text-left text-[12px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={cn('animate-fade-in', message.role === 'user' ? 'pl-6' : '')}>
              {message.role === 'user' ? (
                <p className="rounded-md rounded-br-xs bg-accent px-3 py-2 text-[12.5px] leading-relaxed text-white">
                  {message.content}
                </p>
              ) : (
                <div>
                  {message.failed ? (
                    <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
                      {t('ai.failed')}
                    </p>
                  ) : (
                    <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink">{message.content}</p>
                  )}

                  {message.descriptions.length > 0 && (
                    <ul className="mt-2 space-y-1 rounded-md border border-line bg-base p-2">
                      {message.descriptions.slice(0, 12).map((description, i) => (
                        <li key={i} className="flex gap-1.5 text-[11.5px] text-ink-muted">
                          <Check size={11} className="mt-0.5 shrink-0 text-positive" />
                          <span>{description}</span>
                        </li>
                      ))}
                      {message.descriptions.length > 12 && (
                        <li className="text-[11px] text-ink-faint">
                          +{message.descriptions.length - 12} more
                        </li>
                      )}
                    </ul>
                  )}

                  {(message.partial ?? 0) > 0 && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-warning">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {t('ai.partial', { count: message.partial as number })}
                    </p>
                  )}

                  {message.entryId && (
                    <button
                      onClick={() => {
                        undo();
                        setMessages((m) =>
                          m.map((entry) => (entry.id === message.id ? { ...entry, entryId: undefined } : entry)),
                        );
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-[11.5px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                    >
                      <Undo2 size={11} /> {t('ai.undoThis')}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="rounded-md border border-line bg-base p-2.5">
              <ul className="space-y-1">
                {steps.map((entry, i) => (
                  <li key={`${entry.step}-${i}`} className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                    {entry.done ? (
                      <Check size={11} className="text-positive" />
                    ) : (
                      <Loader2 size={11} className="animate-spin-slow text-accent" />
                    )}
                    {t(STEP_KEYS[entry.step])}
                  </li>
                ))}
              </ul>
              {toolLog.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-t border-line pt-2">
                  {toolLog.slice(-6).map((entry, i) => (
                    <li key={i} className="truncate text-[11px] text-ink-faint">
                      {entry}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {confirm && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-warning">
                <AlertTriangle size={12} /> {t('ai.confirmTitle')}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
                {t('ai.confirmBody')} {confirm.reason}
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" onClick={() => setConfirm(null)}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" variant="primary" onClick={() => void send(confirm.prompt, true)}>
                  {t('common.continue')}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] leading-relaxed text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="shrink-0 border-t border-line p-2.5"
      >
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder={t('ai.placeholder')}
            disabled={busy}
            className="w-full resize-none rounded-md border border-line bg-base py-2 pr-10 pl-3 text-[12.5px] text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label={t('ai.send')}
            className="absolute right-2 bottom-2 grid h-7 w-7 place-items-center rounded-sm bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-35"
          >
            {busy ? <Loader2 size={13} className="animate-spin-slow" /> : <ArrowUp size={14} />}
          </button>
        </div>
      </form>
    </aside>
  );
}
