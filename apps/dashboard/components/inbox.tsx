"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ConversationView, draftReply, getThread, listConversations, type MessageView, replyToConversation, setConversationStatus } from "@/lib/api";
import { age } from "@/lib/format";
import { waFormat } from "@/lib/wa-format";

/** An inbound photo: the API serves its bytes at /media/:messageId, the session cookie travels along. */
function isImage(payload: unknown): boolean {
  const p = payload as { kind?: unknown; mediaType?: unknown } | null;
  return !!p && typeof p === "object" && p.kind === "media" && p.mediaType === "image";
}

const LIST_POLL_MS = 8000;
const THREAD_POLL_MS = 4000;

const STATUS_BADGE: Record<ConversationView["status"], { label: string; cls: string }> = {
  bot: { label: "Bot", cls: "bg-slate-100 text-slate-600" },
  human: { label: "Agent", cls: "bg-amber-100 text-amber-800" },
  closed: { label: "Closed", cls: "bg-slate-200 text-slate-500" },
};

const name = (c: ConversationView) => c.customer?.name || (c.customer?.waId ? `+${c.customer.waId}` : "Customer");

export function Inbox() {
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<{ conversation: ConversationView; messages: MessageView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const data = await listConversations();
      setConversations(data.conversations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conversations");
    } finally {
      setLoaded(true);
    }
  }, []);

  const refreshThread = useCallback(async (id: string) => {
    try {
      setThread(await getThread(id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setSelected(null);
    }
  }, []);

  useEffect(() => {
    void refreshList();
    const t = setInterval(() => void refreshList(), LIST_POLL_MS);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    if (!selected) {
      setThread(null);
      return;
    }
    void refreshThread(selected);
    const t = setInterval(() => void refreshThread(selected), THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [selected, refreshThread]);

  return (
    <div className="grid h-[calc(100vh-7.5rem)] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-[20rem_1fr]">
      <aside className="flex flex-col border-r border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h1 className="font-semibold">Inbox</h1>
          <span className="text-xs text-slate-500">{error ? <span className="text-red-600">{error}</span> : `${conversations.length} chats`}</span>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {loaded && conversations.length === 0 ? <li className="px-4 py-8 text-center text-sm text-slate-400">No conversations yet</li> : null}
          {conversations.map((c) => {
            const badge = STATUS_BADGE[c.status];
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selected === c.id ? "bg-slate-100" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{name(c)}</span>
                    <span className="shrink-0 text-xs text-slate-400">{c.lastMessage ? age(c.lastMessage.createdAt) : age(c.updatedAt)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500" dir="auto">
                      {c.lastMessage ? `${c.lastMessage.direction === "out" ? "You: " : ""}${c.lastMessage.preview}` : "No messages"}
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-col">
        {thread ? (
          <Thread
            key={thread.conversation.id}
            conversation={thread.conversation}
            messages={thread.messages}
            onChange={async () => {
              await refreshThread(thread.conversation.id);
              await refreshList();
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Pick a conversation</div>
        )}
      </section>
    </div>
  );
}

function Thread({ conversation, messages, onChange }: { conversation: ConversationView; messages: MessageView[]; onChange: () => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await replyToConversation(conversation.id, draft.trim());
      setDraft("");
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  /** Asks the assistant for a reply; whatever is typed already becomes the instruction for it. */
  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const { text } = await draftReply(conversation.id, draft.trim() || undefined);
      setDraft(text);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 503 ? "AI drafting is off: set ANTHROPIC_API_KEY on the server." : err instanceof Error ? err.message : "Could not draft");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: ConversationView["status"]) {
    setBusy(true);
    try {
      await setConversationStatus(conversation.id, status);
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  const badge = STATUS_BADGE[conversation.status];
  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{name(conversation)}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
          </div>
          <div className="text-xs text-slate-500">
            {conversation.customer?.waId ? (
              <a href={`https://wa.me/${conversation.customer.waId}`} target="_blank" rel="noreferrer" className="underline">
                +{conversation.customer.waId}
              </a>
            ) : null}
            {conversation.lastInboundAt ? ` · last wrote ${age(conversation.lastInboundAt)} ago` : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {conversation.status === "human" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("bot")} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:border-slate-400 disabled:opacity-50">
              Hand back to bot
            </button>
          ) : conversation.status === "bot" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("human")} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:border-slate-400 disabled:opacity-50">
              Take over
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setStatus("bot")} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:border-slate-400 disabled:opacity-50">
              Reopen
            </button>
          )}
          {conversation.status !== "closed" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("closed")} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400 disabled:opacity-50">
              Close
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div
              dir="auto"
              className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm ${
                m.direction === "out" ? "rounded-br-sm bg-green-100 text-green-950" : "rounded-bl-sm bg-white text-slate-900"
              }`}
            >
              {m.direction === "in" && isImage(m.payload) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/merchant/conversations/${encodeURIComponent(conversation.id)}/media/${encodeURIComponent(m.id)}`} alt={m.preview} className="mb-1 max-h-64 rounded-lg" loading="lazy" />
              ) : null}
              {m.preview ? waFormat(m.preview, m.id) : <span className="italic text-slate-400">[{m.kind}]</span>}
              <div className={`mt-1 text-[10px] ${m.direction === "out" ? "text-green-700/70" : "text-slate-400"}`}>
                {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {m.direction === "out" && m.status ? ` · ${m.status}` : ""}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="border-t border-slate-200 p-3">
        {conversation.windowOpen ? (
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Reply as the business…"
              dir="auto"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button
              type="button"
              disabled={busy}
              onClick={suggest}
              title="Let the assistant draft a reply from the conversation; type a hint first to steer it"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:border-slate-400 disabled:opacity-50"
            >
              Draft with AI
            </button>
            <button type="submit" disabled={busy || !draft.trim()} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              Send
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            The customer last wrote {conversation.lastInboundAt ? `${age(conversation.lastInboundAt)} ago` : "never"}. WhatsApp allows free replies only
            within 24 hours of their last message; order updates still go out as templates.
          </p>
        )}
        {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      </form>
    </>
  );
}
