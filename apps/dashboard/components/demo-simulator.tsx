"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createDemoCustomer,
  type DemoCustomer,
  type DemoInput,
  type DemoThread,
  getDemoThread,
  listDemoCustomers,
  type MessageView,
  resetDemoCustomer,
  sendDemoMessage,
} from "@/lib/api";

const POLL_MS = 5000;

/** Where a demo customer "is" when the bot asks for a location: Dubai Mall. */
const DEMO_LOCATION = { latitude: 25.1972, longitude: 55.2744, name: "Dubai Mall", address: "Financial Centre Rd, Dubai" };

/* Shapes of the stored payloads: Cloud API bodies for bot messages, normalized content for customer messages. */
interface ReplyButton {
  reply: { id: string; title: string };
}
interface ListRow {
  id: string;
  title: string;
  description?: string;
}
interface Interactive {
  type: "button" | "list" | "location_request_message";
  header?: { type: "text"; text: string };
  body: { text: string };
  footer?: { text: string };
  action: { buttons?: ReplyButton[]; button?: string; sections?: Array<{ title?: string; rows: ListRow[] }> };
}
interface OutPayload {
  type: "text" | "interactive" | "template" | "image";
  text?: { body: string };
  interactive?: Interactive;
  template?: { name: string; components?: Array<{ type: string; parameters?: Array<{ type: string; text?: string }> }> };
  image?: { link?: string; caption?: string };
}
interface InPayload {
  kind: string;
  text?: string;
  title?: string;
  name?: string;
  address?: string;
}

export function DemoSimulator() {
  const [customers, setCustomers] = useState<DemoCustomer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<DemoThread | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const { customers } = await listDemoCustomers();
      setCustomers(customers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load demo customers");
    }
  }, []);

  const refreshThread = useCallback(async (waId: string) => {
    try {
      setThread(await getDemoThread(waId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the conversation");
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!selected) return;
    void refreshThread(selected);
    const id = setInterval(() => {
      if (!busy) void refreshThread(selected);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [selected, busy, refreshThread]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const c = await createDemoCustomer(newName.trim());
      setNewName("");
      await refreshList();
      setSelected(c.waId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the customer");
    } finally {
      setBusy(false);
    }
  }

  async function send(input: DemoInput) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      setThread(await sendDemoMessage(selected, input));
      void refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    if (!selected) return;
    setBusy(true);
    try {
      setThread(await resetDemoCustomer(selected));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restart");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Demo</h1>
          <p className="mt-1 text-sm text-slate-500">
            Chat with the bot as a customer would on WhatsApp. Demo customers never reach Meta; everything else (bookings, orders, inbox) is real.
          </p>
        </div>
        <form onSubmit={create} className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New customer name"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button type="submit" disabled={busy || !newName.trim()} className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            Add
          </button>
        </form>
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {customers.length === 0 ? <li className="px-3 py-4 text-sm text-slate-400">No demo customers yet. Add one to start.</li> : null}
          {customers.map((c) => (
            <li key={c.waId}>
              <button
                type="button"
                onClick={() => setSelected(c.waId)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 ${selected === c.waId ? "bg-green-50" : ""}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{initials(c.name)}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-slate-400">+{c.waId}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
          <p className="font-medium text-slate-700">Try</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Natural style (Settings › Conversation): just talk, e.g. “can I get a haircut tomorrow afternoon?”, “what do you charge for colour?”, “cancel my booking”</li>
            <li>Guided style: “hi” shows the menu; tap the buttons and list rows</li>
            <li>“I want to talk to someone” hands the chat to a human; reply from the Inbox and it shows up here</li>
          </ul>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </aside>

      <section className="flex justify-center">
        {thread ? <Phone thread={thread} busy={busy} onSend={send} onRestart={restart} /> : <div className="pt-20 text-sm text-slate-400">Pick or add a customer</div>}
      </section>
    </div>
  );
}

function Phone({ thread, busy, onSend, onRestart }: { thread: DemoThread; busy: boolean; onSend: (input: DemoInput) => Promise<void>; onRestart: () => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [sheet, setSheet] = useState<Interactive | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = thread.messages.at(-1)?.id;
  const lastBotId = [...thread.messages].reverse().find((m) => m.direction === "out")?.id;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await onSend({ kind: "text", text });
  }

  const human = thread.conversation.status === "human";

  return (
    <div className="relative flex h-[720px] w-full max-w-[380px] flex-col overflow-hidden rounded-[2rem] border-[6px] border-slate-900 bg-[#e5ddd5] shadow-xl">
      <header className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">{initials(thread.customer.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{thread.customer.name}</div>
          <div className="text-[11px] text-white/80">{busy ? "typing…" : human ? "agent has taken over" : "online"}</div>
        </div>
        <button type="button" onClick={onRestart} disabled={busy} title="Forget the current flow and start over" className="rounded-md bg-white/15 px-2 py-1 text-[11px] font-medium hover:bg-white/25 disabled:opacity-50">
          Restart
        </button>
      </header>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {thread.messages.length === 0 ? <p className="py-10 text-center text-xs text-slate-500">Say hi to start.</p> : null}
        {thread.messages.map((m) =>
          m.direction === "in" ? (
            <CustomerBubble key={m.id} message={m} />
          ) : (
            <BotBubble key={m.id} message={m} active={m.id === lastBotId && !busy} onSend={onSend} onOpenList={setSheet} />
          ),
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 bg-[#f0f0f0] px-2 py-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message"
          dir="auto"
          disabled={busy}
          className="min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
        />
        <button type="submit" disabled={busy || !draft.trim()} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#128c7e] text-white disabled:opacity-50" aria-label="Send">
          ➤
        </button>
      </form>

      {sheet ? (
        <div className="absolute inset-0 flex flex-col justify-end bg-black/40" onClick={() => setSheet(null)} onKeyDown={(e) => e.key === "Escape" && setSheet(null)} role="presentation">
          <div className="max-h-[75%] overflow-y-auto rounded-t-2xl bg-white" onClick={(e) => e.stopPropagation()} onKeyDown={() => undefined} role="presentation">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 text-sm font-semibold">
              <span>{sheet.action.button ?? "Options"}</span>
              <button type="button" onClick={() => setSheet(null)} className="text-slate-400" aria-label="Close">
                ✕
              </button>
            </div>
            {(sheet.action.sections ?? []).map((s, i) => (
              <div key={s.title ?? i}>
                {s.title ? <div className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">{s.title}</div> : null}
                {s.rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={async () => {
                      setSheet(null);
                      await onSend({ kind: "list", id: r.id, title: r.title, description: r.description });
                    }}
                    className="block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <div className="text-sm" dir="auto">
                      {r.title}
                    </div>
                    {r.description ? (
                      <div className="text-xs text-slate-500" dir="auto">
                        {r.description}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CustomerBubble({ message }: { message: MessageView }) {
  const p = message.payload as InPayload;
  const body = p.kind === "text" ? p.text : p.kind === "location" ? `📍 ${p.name ?? "Location"}${p.address ? `, ${p.address}` : ""}` : p.title || message.preview;
  return (
    <div className="flex justify-end">
      <div dir="auto" className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-1.5 text-sm text-slate-900 shadow-sm">
        {p.kind === "button" || p.kind === "list" ? <span className="mr-1 text-[10px] uppercase text-slate-500">{p.kind === "button" ? "tapped" : "picked"}</span> : null}
        {body}
        <Time at={message.createdAt} />
      </div>
    </div>
  );
}

function BotBubble({ message, active, onSend, onOpenList }: { message: MessageView; active: boolean; onSend: (i: DemoInput) => Promise<void>; onOpenList: (i: Interactive) => void }) {
  const p = message.payload as OutPayload;
  const i = p.interactive;
  const body = p.type === "text" ? p.text?.body : i ? i.body.text : p.type === "template" ? templateText(p) : (p.image?.caption ?? "Image");
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1">
        <div dir="auto" className="whitespace-pre-wrap rounded-lg rounded-tl-none bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm">
          {i?.header ? <div className="mb-0.5 font-semibold">{i.header.text}</div> : null}
          {p.type === "template" ? <div className="mb-0.5 text-[10px] uppercase text-slate-400">template · {p.template?.name}</div> : null}
          {body}
          {i?.footer ? <div className="mt-0.5 text-xs text-slate-500">{i.footer.text}</div> : null}
          <Time at={message.createdAt} />
        </div>
        {i?.type === "button" ? (
          <div className="space-y-1">
            {(i.action.buttons ?? []).map((b) => (
              <button
                key={b.reply.id}
                type="button"
                disabled={!active}
                onClick={() => onSend({ kind: "button", id: b.reply.id, title: b.reply.title })}
                className="block w-full rounded-lg bg-white py-1.5 text-center text-sm font-medium text-[#00a5f4] shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {b.reply.title}
              </button>
            ))}
          </div>
        ) : null}
        {i?.type === "list" ? (
          <button type="button" disabled={!active} onClick={() => onOpenList(i)} className="block w-full rounded-lg bg-white py-1.5 text-center text-sm font-medium text-[#00a5f4] shadow-sm hover:bg-slate-50 disabled:opacity-50">
            ☰ {i.action.button ?? "Choose"}
          </button>
        ) : null}
        {i?.type === "location_request_message" ? (
          <button type="button" disabled={!active} onClick={() => onSend({ kind: "location", ...DEMO_LOCATION })} className="block w-full rounded-lg bg-white py-1.5 text-center text-sm font-medium text-[#00a5f4] shadow-sm hover:bg-slate-50 disabled:opacity-50">
            📍 Send location
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Time({ at }: { at: string }) {
  return <span className="ml-2 align-bottom text-[10px] text-slate-400">{new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>;
}

function templateText(p: OutPayload): string {
  const params = (p.template?.components ?? []).flatMap((c) => c.parameters ?? []).map((x) => x.text).filter(Boolean);
  return params.length ? params.join(" · ") : `Template ${p.template?.name ?? ""}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
