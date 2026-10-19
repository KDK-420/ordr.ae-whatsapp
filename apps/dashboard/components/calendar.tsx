"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, listBookings, me, type OrderView, type Resource, type StateMachine, transitionOrder } from "@/lib/api";
import { DESTRUCTIVE_EVENTS, EVENT_LABEL, label, localized, money, STATUS_LABEL, timeOf } from "@/lib/format";

const POLL_MS = 15000;
/** Hours shown on the day grid; bookings outside still render, clamped to the edge. */
const DAY_START = 8;
const DAY_END = 22;
const PX_PER_MIN = 1.1;

const STATUS_STYLE: Record<string, string> = {
  requested: "border-amber-300 bg-amber-50 text-amber-900",
  confirmed: "border-sky-300 bg-sky-50 text-sky-900",
  checked_in: "border-violet-300 bg-violet-50 text-violet-900",
  in_progress: "border-brand bg-green-50 text-green-900",
  completed: "border-slate-300 bg-slate-100 text-slate-500",
  cancelled: "border-slate-200 bg-slate-50 text-slate-400 line-through",
  rejected: "border-slate-200 bg-slate-50 text-slate-400 line-through",
  no_show: "border-red-200 bg-red-50 text-red-700",
};

/** "2026-10-20" for a Date in a zone. */
function dateKey(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts;
}

/** Minutes since midnight of an instant in a zone. */
function minutesInDay(iso: string, timeZone: string): number {
  const [h, m] = timeOf(iso, timeZone).split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** UTC bounds of a local calendar day, found by probing the zone offset at noon. */
function dayBounds(key: string, timeZone: string): { from: string; to: string } {
  const noonUtc = new Date(`${key}T12:00:00Z`);
  const localNoon = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(noonUtc);
  const offsetHours = Number(localNoon) - 12;
  const start = new Date(noonUtc.getTime() - (12 + offsetHours) * 3_600_000);
  return { from: start.toISOString(), to: new Date(start.getTime() + 24 * 3_600_000).toISOString() };
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

export function Calendar() {
  const [timeZone, setTimeZone] = useState<string>("Asia/Dubai");
  const [day, setDay] = useState<string | null>(null);
  const [bookings, setBookings] = useState<OrderView[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [states, setStates] = useState<StateMachine | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    me()
      .then((s) => {
        const tz = s.tenant?.timezone || "Asia/Dubai";
        setTimeZone(tz);
        setDay(dateKey(new Date(), tz));
      })
      .catch(() => setDay(dateKey(new Date(), "Asia/Dubai")));
  }, []);

  const refresh = useCallback(async () => {
    if (!day) return;
    const { from, to } = dayBounds(day, timeZone);
    try {
      const data = await listBookings(from, to);
      setBookings(data.bookings);
      setResources(data.resources);
      setStates(data.states);
      setTimeZone(data.timezone);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bookings");
    } finally {
      setLoaded(true);
    }
  }, [day, timeZone]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function apply(order: OrderView, event: string) {
    if (DESTRUCTIVE_EVENTS.has(event) && !window.confirm(`${label(EVENT_LABEL, event)} booking #${order.number}?`)) return;
    setBusy(order.id);
    try {
      const updated = await transitionOrder(order.id, event);
      setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the booking");
    } finally {
      setBusy(null);
    }
  }

  const columns = useMemo(() => {
    const active = resources.filter((r) => r.isActive || bookings.some((b) => b.resourceId === r.id));
    const cols = active.map((r) => ({ resource: r, bookings: bookings.filter((b) => b.resourceId === r.id) }));
    const unassigned = bookings.filter((b) => !b.resourceId || !active.some((r) => r.id === b.resourceId));
    return unassigned.length ? [...cols, { resource: null, bookings: unassigned }] : cols;
  }, [resources, bookings]);

  const hours = useMemo(() => Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i), []);
  const gridHeight = (DAY_END - DAY_START) * 60 * PX_PER_MIN;
  const current = selected ? bookings.find((b) => b.id === selected) ?? null : null;
  const today = dateKey(new Date(), timeZone);
  const title = day ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)) : "";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Calendar</h1>
          <span className="text-sm text-slate-500">{timeZone}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => day && setDay(shiftDay(day, -1))} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-400" aria-label="Previous day">
            ‹
          </button>
          <button type="button" onClick={() => setDay(today)} className={`rounded-md border px-3 py-1.5 text-sm ${day === today ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 hover:border-slate-400"}`}>
            Today
          </button>
          <button type="button" onClick={() => day && setDay(shiftDay(day, 1))} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-400" aria-label="Next day">
            ›
          </button>
          <input type="date" value={day ?? ""} onChange={(e) => e.target.value && setDay(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
      </div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-slate-500">{error ? <span className="text-red-600">{error}</span> : loaded ? `${bookings.length} booking${bookings.length === 1 ? "" : "s"}` : "Loading…"}</span>
      </div>

      {loaded && resources.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          No team members yet. Add stylists, rooms or chairs under Settings › Team and hours so customers can book them.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="flex min-w-max">
          <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-slate-200 bg-white">
            <div className="h-10 border-b border-slate-200" />
            <div className="relative" style={{ height: gridHeight }}>
              {hours.map((h) => (
                <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-slate-400" style={{ top: (h - DAY_START) * 60 * PX_PER_MIN }}>
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
          </div>
          {columns.map((col) => (
            <div key={col.resource?.id ?? "unassigned"} className="w-56 shrink-0 border-r border-slate-100 last:border-r-0">
              <div className={`flex h-10 items-center justify-between border-b border-slate-200 px-3 text-sm font-medium ${col.resource && !col.resource.isActive ? "text-slate-400" : ""}`}>
                <span className="truncate">{col.resource ? localized(col.resource.name) : "Unassigned"}</span>
                <span className="text-xs font-normal text-slate-400">{col.bookings.length}</span>
              </div>
              <div className="relative" style={{ height: gridHeight }}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: (h - DAY_START) * 60 * PX_PER_MIN }} />
                ))}
                {col.resource ? <OffHours resource={col.resource} day={day} /> : null}
                {col.bookings.map((b) => {
                  const start = b.scheduledAt ? minutesInDay(b.scheduledAt, timeZone) : DAY_START * 60;
                  const top = Math.max(0, (start - DAY_START * 60) * PX_PER_MIN);
                  const height = Math.max(22, (b.durationMinutes ?? 30) * PX_PER_MIN - 2);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelected(b.id)}
                      className={`absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-left text-xs shadow-sm ${STATUS_STYLE[b.status] ?? "border-slate-300 bg-white"} ${selected === b.id ? "ring-2 ring-slate-900" : ""}`}
                      style={{ top, height }}
                    >
                      <div className="truncate font-medium">
                        {b.scheduledAt ? timeOf(b.scheduledAt, timeZone) : ""} {b.items[0]?.title ?? "Booking"}
                      </div>
                      <div className="truncate">{b.customer?.name ?? (b.customer?.waId ? `+${b.customer.waId}` : "Customer")}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {current ? <BookingDetail booking={current} states={states} timeZone={timeZone} resources={resources} busy={busy} onAction={apply} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

/** Greys out the hours a person does not work on this weekday. */
function OffHours({ resource, day }: { resource: Resource; day: string | null }) {
  if (!day) return null;
  const weekday = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[new Date(`${day}T12:00:00Z`).getUTCDay()]!;
  const ranges = resource.hours[weekday] ?? [];
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number) as [number, number];
    return h * 60 + m;
  };
  const gaps: Array<[number, number]> = [];
  let cursor = DAY_START * 60;
  for (const r of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    const s = toMin(r.start);
    const e = toMin(r.end);
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < DAY_END * 60) gaps.push([cursor, DAY_END * 60]);
  return (
    <>
      {gaps.map(([s, e]) => (
        <div key={s} className="absolute inset-x-0 bg-slate-50" style={{ top: (s - DAY_START * 60) * PX_PER_MIN, height: (e - s) * PX_PER_MIN }} />
      ))}
    </>
  );
}

function BookingDetail({
  booking,
  states,
  timeZone,
  resources,
  busy,
  onAction,
  onClose,
}: {
  booking: OrderView;
  states: StateMachine | null;
  timeZone: string;
  resources: Resource[];
  busy: string | null;
  onAction: (o: OrderView, e: string) => void;
  onClose: () => void;
}) {
  void states;
  const resource = resources.find((r) => r.id === booking.resourceId);
  const end = booking.scheduledAt && booking.durationMinutes ? new Date(new Date(booking.scheduledAt).getTime() + booking.durationMinutes * 60_000).toISOString() : null;
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()} role="presentation">
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} onKeyDown={() => undefined} role="presentation">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Booking #{booking.number}</h2>
            <p className="text-sm text-slate-500">{label(STATUS_LABEL, booking.status)}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">When</dt>
            <dd className="text-right">
              {booking.scheduledAt ? `${new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(booking.scheduledAt))}, ${timeOf(booking.scheduledAt, timeZone)}` : "–"}
              {end ? ` – ${timeOf(end, timeZone)}` : ""}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">With</dt>
            <dd>{resource ? localized(resource.name) : "Unassigned"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Customer</dt>
            <dd className="text-right">
              {booking.customer?.name ?? "Customer"}
              {booking.customer?.waId ? (
                <a href={`https://wa.me/${booking.customer.waId}`} target="_blank" rel="noreferrer" className="block text-xs text-slate-500 underline">
                  +{booking.customer.waId}
                </a>
              ) : null}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Service</dt>
            <dd className="text-right">
              {booking.items.map((i) => (
                <div key={i.title}>
                  {i.title} · {money(i.lineTotalMinor, booking.currency)}
                </div>
              ))}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-slate-100 pt-2 font-medium">
            <dt>Total</dt>
            <dd>{money(booking.totalMinor, booking.currency)}</dd>
          </div>
        </dl>
        {booking.allowedEvents.length ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {booking.allowedEvents.map((e) => (
              <button
                key={e}
                type="button"
                disabled={busy === booking.id}
                onClick={() => onAction(booking, e)}
                className={
                  DESTRUCTIVE_EVENTS.has(e)
                    ? "rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-red-400 hover:text-red-700 disabled:opacity-50"
                    : "rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                }
              >
                {label(EVENT_LABEL, e)}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-slate-500">This booking is {label(STATUS_LABEL, booking.status).toLowerCase()}; nothing more to do.</p>
        )}
      </div>
    </div>
  );
}
