"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/suite/icons";
import { Logo, useLive, useSuite } from "@/components/suite/shell";
import { kdsAdvance, kdsBoard, kdsSetLine, type KitchenBoard, type KitchenColumn, type KitchenLine, type KitchenTicket } from "@/lib/suite";

const COLUMNS: Array<{ id: KitchenColumn; title: string; bar: string; action?: { do: "start" | "ready" | "complete"; label: string; button: string } }> = [
  { id: "new", title: "New Orders", bar: "bg-sp", action: { do: "start", label: "Start", button: "bg-sp text-white" } },
  { id: "preparing", title: "Preparing", bar: "bg-amber-500", action: { do: "ready", label: "Ready", button: "bg-amber-500 text-white" } },
  { id: "ready", title: "Ready", bar: "bg-emerald-600", action: { do: "complete", label: "Complete", button: "bg-emerald-600 text-white" } },
  { id: "completed", title: "Completed", bar: "bg-white/25" },
];

const TYPE_LABEL: Record<string, string> = { dine_in: "Dine In", pickup: "Takeaway", delivery: "Delivery" };
const SOURCE_LABEL: Record<string, string> = { pos: "Till", web: "Online", whatsapp: "WhatsApp", webchat: "Web chat" };
const SOUND_KEY = "ordr.kds.sound";

const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));

/** A short two-tone chime for a new ticket; silent when the browser has not been touched yet. */
function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const at = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.start(at);
      osc.stop(at + 0.32);
    });
    setTimeout(() => void ctx.close(), 900);
  } catch {
    // no audio on this device
  }
}

/** The kitchen display: every open order of the branch as a ticket, in four columns, live. */
export function KitchenDisplay() {
  const { suite, base, branch, has } = useSuite();
  const [board, setBoard] = useState<KitchenBoard | null>(null);
  const [stationId, setStationId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [skew, setSkew] = useState(0);
  const [sound, setSound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const load = useCallback(async () => {
    try {
      const next = await kdsBoard({ branchId: branch.id, stationId: stationId || undefined });
      setSkew(new Date(next.serverTime).getTime() - Date.now());
      const fresh = new Set(next.tickets.filter((t) => t.column === "new").map((t) => t.orderId));
      if (known.current && soundRef.current && [...fresh].some((id) => !known.current!.has(id))) chime();
      known.current = fresh;
      setBoard(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the kitchen board");
    }
  }, [branch.id, stationId]);

  useEffect(() => {
    known.current = null;
    void load();
  }, [load]);
  useLive(() => void load());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    try {
      setSound(window.localStorage.getItem(SOUND_KEY) === "on");
    } catch {
      // stays off
    }
    return () => clearInterval(t);
  }, []);

  const act = async (ticket: KitchenTicket, action: "start" | "ready" | "complete") => {
    setBusy(ticket.orderId);
    try {
      await kdsAdvance(ticket.orderId, action, stationId || undefined);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work");
    } finally {
      setBusy(null);
    }
  };

  const tapLine = async (ticket: KitchenTicket, line: KitchenLine) => {
    if (ticket.column === "completed" || line.status === "served") return;
    const next = line.status === "queued" ? "preparing" : line.status === "preparing" ? "ready" : "preparing";
    try {
      await kdsSetLine(ticket.orderId, line.id, next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work");
    }
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    if (next) chime();
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // not remembered
    }
  };

  const byColumn = useMemo(() => {
    const map: Record<KitchenColumn, KitchenTicket[]> = { new: [], preparing: [], ready: [], completed: [] };
    for (const t of board?.tickets ?? []) map[t.column].push(t);
    return map;
  }, [board]);

  if (!has("kds")) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-si px-6 text-center text-white">
        <p className="text-lg font-semibold">The kitchen display is not switched on for {suite.tenant.name}.</p>
        <Link href={base || "/"} className="mt-5 rounded-lg bg-sp px-4 py-2 text-sm font-semibold">
          Back to apps
        </Link>
      </div>
    );
  }

  const clock = new Date(now + skew).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: suite.tenant.timezone });
  const stations = board?.stations ?? branch.stations;
  const stats = board?.stats;
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-si text-white">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6">
        <Link href={base || "/"} className="flex items-center gap-3" title="All apps">
          <Logo theme={suite.theme} name={suite.tenant.name} size={34} />
          <span className="text-lg font-semibold tracking-tight md:text-xl">
            KDS <span className="text-white/50">–</span> {board?.branch.name ?? branch.name}
          </span>
        </Link>
        <div className="no-scrollbar order-3 flex w-full gap-2 overflow-x-auto md:order-none md:ml-4 md:w-auto">
          {[{ id: "", name: "All stations" }, ...stations].map((s) => (
            <button
              key={s.id || "all"}
              onClick={() => setStationId(s.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${stationId === s.id ? "bg-white text-si" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="mr-2 flex items-center gap-2 text-lg font-semibold tabular-nums md:text-xl">
            <Icon name="clock" size={20} className="text-white/60" />
            {clock}
          </span>
          <button onClick={toggleSound} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${sound ? "bg-emerald-600" : "bg-white/10 text-white/80"}`} aria-pressed={sound}>
            Sound {sound ? "on" : "off"}
          </button>
          <button onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen().catch(() => undefined))} className="rounded-lg bg-white/10 p-2 text-white/80 hover:bg-white/20" aria-label="Full screen">
            <Icon name="expand" size={18} />
          </button>
        </div>
      </header>

      {error ? <p className="mx-4 mb-2 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100 md:mx-6">{error}</p> : null}

      <div className="no-scrollbar grid min-h-0 flex-1 auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-3 md:px-6 lg:grid-cols-4 lg:overflow-x-visible">
        {COLUMNS.map((col) => (
          <section key={col.id} className="flex min-h-0 flex-col rounded-2xl bg-white/[0.06]">
            <h2 className="flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-wide">
              <span className={`h-2.5 w-2.5 rounded-full ${col.bar}`} />
              {col.title}
              <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums">{byColumn[col.id].length}</span>
            </h2>
            <div className="suite-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
              {byColumn[col.id].map((t) => (
                <Ticket key={t.orderId} ticket={t} column={col} now={now + skew} busy={busy === t.orderId} onAct={act} onLine={tapLine} />
              ))}
              {board && byColumn[col.id].length === 0 ? <p className="px-2 py-6 text-center text-sm text-white/35">{col.id === "new" ? "No new orders" : "Nothing here"}</p> : null}
            </div>
          </section>
        ))}
      </div>

      <footer className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 border-t border-white/10 px-4 py-3 text-sm md:grid-cols-4 md:px-6">
        <Stat label="Today's Orders" value={stats ? String(stats.todayOrders) : "–"} />
        <Stat label="Avg Prep Time" value={stats?.avgPrepSeconds != null ? `${Math.max(1, Math.round(stats.avgPrepSeconds / 60))} min` : "–"} />
        <Stat label="Pending" value={stats ? String(stats.pending) : "–"} />
        <Stat label="Completed" value={stats ? String(stats.completed) : "–"} />
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-white/55">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </p>
  );
}

function Ticket({ ticket, column, now, busy, onAct, onLine }: { ticket: KitchenTicket; column: (typeof COLUMNS)[number]; now: number; busy: boolean; onAct: (t: KitchenTicket, a: "start" | "ready" | "complete") => void; onLine: (t: KitchenTicket, l: KitchenLine) => void }) {
  const fired = new Date(ticket.firedAt).getTime();
  const done = ticket.column === "completed" || ticket.column === "ready";
  const end = ticket.readyAt ? new Date(ticket.readyAt).getTime() : ticket.completedAt ? new Date(ticket.completedAt).getTime() : now;
  const age = minutes((done ? end : now) - fired);
  const ageTone = done ? "bg-si/10 text-si/70" : age >= 10 ? "bg-red-600 text-white" : age >= 5 ? "bg-amber-400 text-si" : "bg-emerald-100 text-emerald-800";
  const who = ticket.tableLabel ? `Table ${ticket.tableLabel}` : ticket.contactName;
  return (
    <article className={`overflow-hidden rounded-xl bg-white text-si shadow-sm ${ticket.column === "completed" ? "opacity-70" : ""}`}>
      <div className={`h-1.5 ${column.bar}`} />
      <div className="p-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tabular-nums">#{ticket.number}</span>
          <span className="rounded-md bg-si/10 px-2 py-0.5 text-xs font-semibold">{TYPE_LABEL[ticket.fulfillmentType] ?? ticket.fulfillmentType}</span>
          <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${ageTone}`}>{age} min</span>
        </div>
        <p className="mt-0.5 text-xs text-si/55">
          {SOURCE_LABEL[ticket.source] ?? ticket.source}
          {who ? ` · ${who}` : ""}
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {ticket.lines.map((l) => (
            <li key={l.id}>
              <button onClick={() => onLine(ticket, l)} className="flex w-full items-start gap-2 text-left" disabled={ticket.column === "completed"}>
                <span className="w-7 shrink-0 font-bold tabular-nums">{l.quantity}×</span>
                <span className="min-w-0 flex-1">
                  <span className={`font-semibold ${l.status === "ready" || l.status === "served" ? "text-si/40 line-through" : ""}`}>{l.title}</span>
                  {l.modifiers.length ? <span className="block text-sm text-si/60">{l.modifiers.join(", ")}</span> : null}
                  {l.notes ? <span className="block text-sm font-medium text-red-700">{l.notes}</span> : null}
                </span>
                {l.status === "preparing" && ticket.column !== "new" ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Being made" /> : null}
                {l.status === "ready" || l.status === "served" ? <Icon name="check" size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : null}
              </button>
            </li>
          ))}
        </ul>
        {ticket.notes ? <p className="mt-2.5 rounded-md bg-amber-50 px-2 py-1.5 text-sm font-medium text-amber-900">{ticket.notes}</p> : null}
        {column.action ? (
          <button disabled={busy} onClick={() => onAct(ticket, column.action!.do)} className={`mt-3 w-full rounded-lg py-2.5 text-sm font-bold uppercase tracking-wide transition active:scale-[0.99] disabled:opacity-60 ${column.action.button}`}>
            {column.action.label}
          </button>
        ) : null}
      </div>
    </article>
  );
}
