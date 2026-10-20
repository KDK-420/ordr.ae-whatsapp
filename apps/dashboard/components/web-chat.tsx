"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getSession, PAY_LINK, sendMessage, startSession, type WebMessage, type WebSession } from "@/lib/webchat";

const STORAGE = (slug: string) => `ordr.chat.${slug}`;

/**
 * Customer-facing chat. One anonymous session per browser tab and business; the token never
 * leaves sessionStorage. Replies come back on the same request, so there is no polling unless a
 * person has taken over the thread.
 */
export function WebChat({ slug }: { slug: string }) {
  const [session, setSession] = useState<WebSession | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<WebMessage | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const boot = useCallback(async () => {
    setError(null);
    try {
      let saved: { id: string; token: string } | null = null;
      try {
        saved = JSON.parse(sessionStorage.getItem(STORAGE(slug)) ?? "null");
      } catch {
        saved = null;
      }
      if (saved) {
        try {
          const s = await getSession(saved.id, saved.token);
          setSession(s);
          setToken(saved.token);
          return;
        } catch {
          sessionStorage.removeItem(STORAGE(slug));
        }
      }
      const language = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
      const created = await startSession(slug, language);
      const { token: t, ...view } = created;
      sessionStorage.setItem(STORAGE(slug), JSON.stringify({ id: view.sessionId, token: t }));
      setSession(view);
      setToken(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the chat.");
    }
  }, [slug]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // When a person has taken over, their replies arrive outside our requests: poll gently.
  useEffect(() => {
    if (!session || !token || session.status !== "human") return;
    const id = setInterval(() => {
      getSession(session.sessionId, token).then(setSession).catch(() => undefined);
    }, 5000);
    return () => clearInterval(id);
  }, [session, token]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.messages.length, pending, busy]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !session || !token || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    const clientMessageId = crypto.randomUUID();
    setPending({ id: clientMessageId, role: "customer", text: body, createdAt: new Date().toISOString() });
    try {
      const next = await sendMessage(session.sessionId, token, body, clientMessageId);
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message not sent.");
      setText(body);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  function reset() {
    sessionStorage.removeItem(STORAGE(slug));
    setSession(null);
    setToken(null);
    void boot();
  }

  const messages = [...(session?.messages ?? []), ...(pending ? [pending] : [])];
  const rtl = session?.tenant.language === "ar";

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{session?.tenant.name ?? "Chat"}</p>
          <p className="text-xs text-slate-500">{session?.status === "human" ? "A team member is replying" : "Assistant, replies in seconds"}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button type="button" onClick={reset} className="text-slate-500 hover:text-slate-800">
            New chat
          </button>
          <Link href="/" className="font-semibold text-slate-700">
            ordr<span className="text-brand">.ae</span>
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4" dir={rtl ? "rtl" : "ltr"}>
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {session && messages.length === 0 ? (
            <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
              Hi! Ask about {session.tenant.blueprintId === "retail" ? "products, prices and delivery, or order right here" : "services, prices and free times, or book right here"}.
            </p>
          ) : null}
          {messages.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
          {busy ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2 text-sm text-slate-400 shadow-sm">typing…</div>
            </div>
          ) : null}
          <div ref={bottom} />
        </div>
      </div>

      <form onSubmit={onSubmit} className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={session ? "Type a message" : "Connecting…"}
            disabled={!session || busy}
            aria-label="Message"
            className="min-w-0 flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-50"
          />
          <button type="submit" disabled={!session || busy || !text.trim()} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            Send
          </button>
        </div>
        {error ? <p className="mx-auto mt-2 max-w-2xl text-xs text-red-600">{error}</p> : null}
      </form>
    </div>
  );
}

function Bubble({ message }: { message: WebMessage }) {
  const mine = message.role === "customer";
  const parts = splitLinks(message.text);
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm shadow-sm ${mine ? "rounded-br-sm bg-brand text-white" : "rounded-bl-sm bg-white text-slate-900"}`}>
        {parts.map((p, i) =>
          p.kind === "link" ? (
            <a key={`${message.id}-${i}`} href={p.href} target="_blank" rel="noreferrer" className={`mt-1 inline-block rounded-md px-3 py-1.5 font-semibold ${mine ? "bg-white/20" : "bg-brand text-white"}`}>
              Pay securely
            </a>
          ) : (
            <span key={`${message.id}-${i}`}>{p.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

function splitLinks(text: string): Array<{ kind: "text"; text: string } | { kind: "link"; href: string }> {
  const out: Array<{ kind: "text"; text: string } | { kind: "link"; href: string }> = [];
  let last = 0;
  for (const m of text.matchAll(PAY_LINK)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "link", href: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
