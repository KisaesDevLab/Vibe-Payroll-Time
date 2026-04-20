import { useMutation } from '@tanstack/react-query';
import type { ChatMessage } from '@vibept/shared';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { ai } from '../lib/resources';

/**
 * Floating support-chat dock. Opens to a dialog the user can type
 * questions into ("How do I approve a pay period?", "What does
 * 'auto-closed' mean?"). Backed by the Phase 11 support-chat endpoint
 * with the "no write actions" guardrail baked into the system prompt.
 */
export function SupportChatWidget() {
  const session = useSession();
  const firstCompanyId = session?.user.memberships[0]?.companyId ?? null;

  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState<number | null>(firstCompanyId);
  useEffect(() => {
    if (!companyId && firstCompanyId) setCompanyId(firstCompanyId);
  }, [firstCompanyId, companyId]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error('no company selected');
      const next: ChatMessage[] = [...messages, { role: 'user', content: input }];
      setMessages(next);
      setInput('');
      const res = await ai.chat(companyId, { messages: next });
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
      return res;
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  if (!session) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-4 z-40 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-slate-800"
        >
          Ask about Vibe PT
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 left-4 z-40 flex h-[500px] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Vibe PT support</p>
              <p className="text-[11px] text-slate-500">
                Answers about the product. Can't take actions.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          {(session.user.memberships.length > 1 && companyId != null) && (
            <label className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              Company
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                value={companyId}
                onChange={(e) => {
                  setCompanyId(Number(e.target.value));
                  setMessages([]);
                }}
              >
                {session.user.memberships.map((m) => (
                  <option key={m.companyId} value={m.companyId}>
                    {m.companyName}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
          >
            {messages.length === 0 && (
              <p className="text-center text-xs text-slate-400">
                Ask how a feature works — e.g. "How do I approve a pay period?"
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'ml-8 rounded-lg bg-slate-900 px-3 py-2 text-white'
                    : 'mr-8 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800'
                }
              >
                {m.content}
              </div>
            ))}
            {send.isPending && (
              <div className="mr-8 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs italic text-slate-500">
                Thinking…
              </div>
            )}
            {send.isError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {send.error instanceof ApiError ? send.error.message : 'Chat failed.'}
              </div>
            )}
          </div>

          <form
            className="flex gap-2 border-t border-slate-200 bg-white p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim() && companyId) send.mutate();
            }}
          >
            <input
              type="text"
              placeholder="Ask about Vibe PT"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              disabled={send.isPending}
            />
            <button
              type="submit"
              disabled={!input.trim() || send.isPending || companyId == null}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-400"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
