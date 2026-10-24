"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ConversationView, draftReply, getThread, listConversations, type MessageView, replyToConversation, setConversationStatus } from "@/lib/api";
import { isMuted, playChime, setMuted, unlockChime } from "@/lib/chime";
import { age } from "@/lib/format";
import { waFormat } from "@/lib/wa-format";

/** An inbound photo: the API serves its bytes at /media/:messageId, the session cookie travels along. */
function isImage(payload: unknown): boolean {
  const p = payload as { kind?: unknown; mediaType?: unknown } | null;
  return !!p && typeof p === "object" && p.kind === "media" && p.mediaType === "image";
}

/** A photo the bot or an agent sent: the Cloud API payload carries its public link. */
function sentImageLink(payload: unknown): string | null {
  const p = payload as { type?: unknown; image?: { link?: unknown } } | null;
  return p && typeof p === "object" && p.type === "image" && typeof p.image?.link === "string" ? p.image.link : null;
}

const LIST_POLL_MS = 8000;
const THREAD_POLL_MS = 4000;

const STATUS_BADGE: Record<ConversationView["status"], { label: string; cls: string }> = {
  bot: { label: "Bot", cls: "bg-slate-100 text-slate-600" },
  human: { label: "Agent", cls: "bg-amber-100 text-amber-800" },
  closed: { label: "Closed", cls: "bg-slate-200 text-slate-500" },
};

const isWebId = (waId: string | undefined) => !!waId && waId.startsWith("web:");
const name = (c: ConversationView) => c.customer?.name || (isWebId(c.customer?.waId) ? "Web visitor" : c.customer?.waId ? `+${c.customer.waId}` : "Customer");
const initial = (c: ConversationView) => (name(c).replace(/^\+/, "").trim()[0] ?? "?").toUpperCase();

/** Phones show the list or one chat, not both. */
const isNarrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

/** Browser notification for a thread the bot just handed over, when the person allowed them. Silent anywhere notifications are unsupported or denied. */
function notifyHandoff(c: ConversationView): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(`${name(c)} needs a person`, { body: c.lastMessage?.preview ?? "Open the inbox to reply", tag: `handoff-${c.id}` });
    n.onclick = () => window.focus();
  } catch {
    // Some browsers throw from the constructor outside a service worker; nothing to do.
  }
}

export function Inbox() {
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<{ conversation: ConversationView; messages: MessageView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPermission | "unsupported">("unsupported");
  const [muted, setMutedState] = useState(false);
  /** Threads already seen as "human", so only a new handoff notifies; null until the first list has loaded. */
  const seenHuman = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifications(Notification.permission);
    setMutedState(isMuted());
    // The chime may only sound after the person has interacted with the page; any click or key unlocks it.
    const unlock = () => unlockChime();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // On phones a chat is a screen of its own: opening one adds a history entry so the back gesture returns to the list.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setSelected((e.state as { inboxThread?: string } | null)?.inboxThread ?? null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function open(id: string) {
    if (id === selected) return;
    if (isNarrow()) window.history.pushState({ inboxThread: id }, "");
    setSelected(id);
  }

  function backToList() {
    if ((window.history.state as { inboxThread?: string } | null)?.inboxThread) window.history.back();
    else setSelected(null);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    unlockChime();
  }

  const refreshList = useCallback(async () => {
    try {
      const data = await listConversations();
      setConversations(data.conversations);
      setError(null);
      const human = data.conversations.filter((c) => c.status === "human");
      if (seenHuman.current) {
        const fresh = human.filter((c) => !seenHuman.current!.has(c.id));
        if (fresh.length > 0) playChime();
        for (const c of fresh) notifyHandoff(c);
      }
      seenHuman.current = new Set(human.map((c) => c.id));
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
    setThread((t) => (t && t.conversation.id === selected ? t : null));
    void refreshThread(selected);
    const t = setInterval(() => void refreshThread(selected), THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [selected, refreshThread]);

  return (
    // The shell gives the inbox the rest of the screen; the single row is capped at that height (minmax(0,1fr)) so only the lists scroll.
    // Phones show the list or the open chat; from md up both sit side by side.
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-white md:grid-cols-[20rem_1fr] md:rounded-lg md:border md:border-slate-200">
      <aside className={`min-h-0 flex-col md:flex md:border-r md:border-slate-200 ${selected ? "hidden" : "flex"}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h1 className="font-semibold">Inbox</h1>
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <button type="button" onClick={toggleMute} className="rounded-md border border-slate-300 px-2 py-0.5 hover:border-slate-400" title={muted ? "Sound is off for handoffs; click to turn it on" : "A chime plays when the bot hands a chat over; click to mute"} aria-pressed={muted}>
              {muted ? "Sound off" : "Sound on"}
            </button>
            {notifications === "default" ? (
              <button type="button" onClick={() => void Notification.requestPermission().then(setNotifications)} className="rounded-md border border-slate-300 px-2 py-0.5 hover:border-slate-400" title="Get a desktop notification when the bot hands a chat over">
                Notify me
              </button>
            ) : null}
            {error ? <span className="text-red-600">{error}</span> : `${conversations.length} chats`}
          </span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {loaded && conversations.length === 0 ? <li className="px-4 py-8 text-center text-sm text-slate-400">No conversations yet</li> : null}
          {conversations.map((c) => {
            const badge = STATUS_BADGE[c.status];
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100 ${selected === c.id ? "md:bg-slate-100" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${c.status === "human" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                  >
                    {initial(c)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.status === "human" ? "font-semibold" : "font-medium"}`}>{name(c)}</span>
                      <span className="shrink-0 text-xs text-slate-400">{c.lastMessage ? age(c.lastMessage.createdAt) : age(c.updatedAt)}</span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500" dir="auto">
                        {c.lastMessage ? `${c.lastMessage.direction === "out" ? "You: " : ""}${c.lastMessage.preview}` : "No messages"}
                      </span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className={`min-h-0 flex-col md:flex ${selected ? "flex" : "hidden"}`}>
        {thread ? (
          <Thread
            key={thread.conversation.id}
            conversation={thread.conversation}
            messages={thread.messages}
            onBack={backToList}
            onChange={async () => {
              await refreshThread(thread.conversation.id);
              await refreshList();
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">{selected ? "Loading…" : "Pick a conversation"}</div>
        )}
      </section>
    </div>
  );
}

function Thread({ conversation, messages, onBack, onChange }: { conversation: ConversationView; messages: MessageView[]; onBack: () => void; onChange: () => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    // Scroll the message list itself, not every ancestor: scrollIntoView would also drag the page and hide the header.
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
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
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-2.5 md:gap-3 md:px-4 md:py-3">
        <button type="button" onClick={onBack} aria-label="Back to chats" className="-ml-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 md:hidden">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{name(conversation)}</span>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
          </div>
          <div className="truncate text-xs text-slate-500">
            {isWebId(conversation.customer?.waId) ? (
              "Web chat"
            ) : conversation.customer?.waId ? (
              <a href={`https://wa.me/${conversation.customer.waId}`} target="_blank" rel="noreferrer" className="underline">
                +{conversation.customer.waId}
              </a>
            ) : null}
            {conversation.lastInboundAt ? ` · last wrote ${age(conversation.lastInboundAt)} ago` : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5 md:gap-2">
          {conversation.status === "human" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("bot")} className="whitespace-nowrap rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:border-slate-400 disabled:opacity-50 md:px-3">
              <span className="md:hidden">To bot</span>
              <span className="hidden md:inline">Hand back to bot</span>
            </button>
          ) : conversation.status === "bot" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("human")} className="whitespace-nowrap rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:border-slate-400 disabled:opacity-50 md:px-3">
              Take over
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setStatus("bot")} className="whitespace-nowrap rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:border-slate-400 disabled:opacity-50 md:px-3">
              Reopen
            </button>
          )}
          {conversation.status !== "closed" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("closed")} className="whitespace-nowrap rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400 disabled:opacity-50 md:px-3">
              Close
            </button>
          ) : null}
        </div>
      </header>

      <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-slate-50 px-3 py-3 md:px-4 md:py-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div
              dir="auto"
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm md:max-w-[75%] ${
                m.direction === "out" ? "rounded-br-sm bg-green-100 text-green-950" : "rounded-bl-sm bg-white text-slate-900"
              }`}
            >
              {m.direction === "in" && isImage(m.payload) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/merchant/conversations/${encodeURIComponent(conversation.id)}/media/${encodeURIComponent(m.id)}`} alt={m.preview} className="mb-1 max-h-64 rounded-lg" loading="lazy" />
              ) : null}
              {m.direction === "out" && sentImageLink(m.payload) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sentImageLink(m.payload)!} alt={m.preview} className="mb-1 max-h-64 rounded-lg" loading="lazy" />
              ) : null}
              {m.preview ? waFormat(m.preview, m.id) : <span className="italic text-slate-400">[{m.kind}]</span>}
              <div className={`mt-1 text-[10px] ${m.direction === "out" ? "text-green-700/70" : "text-slate-400"}`}>
                {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {m.direction === "out" && m.status ? ` · ${m.status}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom padding clears the iPhone home indicator when the dashboard runs from the home screen. */}
      <form onSubmit={send} className="shrink-0 border-t border-slate-200 bg-white px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:p-3">
        {conversation.windowOpen ? (
          <div className="flex items-end gap-1.5 md:gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends on a keyboard; Shift+Enter (and the phone's return key on a narrow screen) adds a line.
                if (e.key === "Enter" && !e.shiftKey && !isNarrow()) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder="Reply as the business…"
              dir="auto"
              aria-label="Reply"
              // 16px on phones: iOS zooms the page into any smaller input when it is focused.
              className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-slate-300 px-3 py-2 text-base [field-sizing:content] outline-none focus:border-brand md:rounded-md md:text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={suggest}
              title="Let the assistant draft a reply from the conversation; type a hint first to steer it"
              aria-label="Draft a reply with AI"
              className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-300 px-3 text-sm font-medium hover:border-slate-400 disabled:opacity-50 md:rounded-md"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" />
              </svg>
              <span className="hidden md:inline">Draft with AI</span>
            </button>
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className="flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50 md:rounded-md md:px-4"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" className="md:hidden">
                <path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.2 1l1.8 6.4c.1.4.4.7.8.7l8.2 1.3-8.2 1.3c-.4.1-.7.3-.8.7l-1.8 6.4c-.2.7.5 1.3 1.2 1z" />
              </svg>
              <span className="hidden md:inline">Send</span>
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
