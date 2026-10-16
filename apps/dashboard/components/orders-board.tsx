"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, listOrders, type OrderView, type StateMachine, transitionOrder } from "@/lib/api";
import { age, DESTRUCTIVE_EVENTS, EVENT_LABEL, FULFILLMENT_LABEL, label, money, STATUS_LABEL } from "@/lib/format";

const POLL_MS = 8000;

/** Board columns in kitchen order. Any status the blueprint adds later lands in "Other". */
const COLUMNS: Array<{ key: string; title: string; statuses: string[] }> = [
  { key: "new", title: "New", statuses: ["placed"] },
  { key: "progress", title: "In progress", statuses: ["accepted", "preparing"] },
  { key: "ready", title: "Ready", statuses: ["ready", "out_for_delivery"] },
  { key: "done", title: "Done (24 h)", statuses: ["delivered", "completed", "cancelled", "rejected"] },
];

export function OrdersBoard() {
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [states, setStates] = useState<StateMachine | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const data = await listOrders("board");
      setOrders(data.orders);
      setStates(data.states);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh]);

  async function apply(order: OrderView, event: string) {
    if (DESTRUCTIVE_EVENTS.has(event) && !window.confirm(`${label(EVENT_LABEL, event)} order #${order.number}?`)) return;
    setBusy(`${order.id}:${event}`);
    try {
      const updated = await transitionOrder(order.id, event);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await refresh();
      else setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const columns = useMemo(() => {
    const known = new Set(COLUMNS.flatMap((c) => c.statuses));
    const other = orders.filter((o) => !known.has(o.status));
    const cols = COLUMNS.map((c) => ({ ...c, orders: orders.filter((o) => c.statuses.includes(o.status)) }));
    return other.length ? [...cols, { key: "other", title: "Other", statuses: [], orders: other }] : cols;
  }, [orders]);

  const current = selected ? orders.find((o) => o.id === selected) ?? null : null;
  void tick; // re-render so the "x min" ages move

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <div className="text-sm text-slate-500">
          {error ? <span className="text-red-600">{error}</span> : loaded ? `Refreshes every ${POLL_MS / 1000}s` : "Loading…"}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((col) => (
          <section key={col.key} className="rounded-lg bg-slate-100 p-3">
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-700">
              {col.title}
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{col.orders.length}</span>
            </h2>
            <div className="space-y-3">
              {col.orders.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">Nothing here</p> : null}
              {col.orders.map((o) => (
                <OrderCard key={o.id} order={o} busy={busy} onAction={apply} onOpen={() => setSelected(o.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {current ? <OrderDetail order={current} states={states} busy={busy} onAction={apply} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function ActionButtons({ order, busy, onAction, size = "sm" }: { order: OrderView; busy: string | null; onAction: (o: OrderView, e: string) => void; size?: "sm" | "md" }) {
  if (order.allowedEvents.length === 0) return null;
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  return (
    <div className="flex flex-wrap gap-2">
      {order.allowedEvents.map((event) => {
        const destructive = DESTRUCTIVE_EVENTS.has(event);
        const isBusy = busy === `${order.id}:${event}`;
        return (
          <button
            key={event}
            type="button"
            disabled={busy !== null}
            onClick={(e) => {
              e.stopPropagation();
              onAction(order, event);
            }}
            className={
              destructive
                ? `rounded-md border border-slate-300 bg-white font-medium text-slate-600 hover:border-red-300 hover:text-red-600 disabled:opacity-50 ${pad}`
                : `rounded-md bg-brand font-semibold text-white hover:bg-brand-dark disabled:opacity-50 ${pad}`
            }
          >
            {isBusy ? "…" : label(EVENT_LABEL, event)}
          </button>
        );
      })}
    </div>
  );
}

function OrderCard({ order, busy, onAction, onOpen }: { order: OrderView; busy: string | null; onAction: (o: OrderView, e: string) => void; onOpen: () => void }) {
  const summary = order.items.map((i) => `${i.quantity}× ${i.title}`).join(", ");
  return (
    <article
      onClick={onOpen}
      className="cursor-pointer rounded-md border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">#{order.number}</span>
        <span className="text-xs text-slate-500">{age(order.createdAt)}</span>
      </div>
      <div className="mt-1 text-sm">{order.customer?.name || order.customer?.waId || "Customer"}</div>
      <div className="mt-1 line-clamp-2 text-xs text-slate-600">{summary}</div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{label(FULFILLMENT_LABEL, order.fulfillmentType)}</span>
        <span className="font-medium">{money(order.totalMinor, order.currency)}</span>
      </div>
      {order.isTerminal ? (
        <div className="mt-2 text-xs text-slate-500">{label(STATUS_LABEL, order.status)}</div>
      ) : (
        <div className="mt-3">
          <ActionButtons order={order} busy={busy} onAction={onAction} />
        </div>
      )}
    </article>
  );
}

function OrderDetail({ order, states, busy, onAction, onClose }: { order: OrderView; states: StateMachine | null; busy: string | null; onAction: (o: OrderView, e: string) => void; onClose: () => void }) {
  const loc = order.deliveryLocation;
  const mapLink = loc ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}` : null;
  const waLink = order.customer?.waId ? `https://wa.me/${order.customer.waId}` : null;
  void states;
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Order #{order.number}</h2>
            <p className="text-sm text-slate-500">
              {label(STATUS_LABEL, order.status)} · {label(FULFILLMENT_LABEL, order.fulfillmentType)} · {age(order.createdAt)} ago
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            ✕
          </button>
        </div>

        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</h3>
          <p className="mt-1 text-sm">
            {order.customer?.name || "Unknown name"}
            {order.customer?.waId ? (
              <>
                {" · "}
                <a href={waLink ?? "#"} target="_blank" rel="noreferrer" className="text-brand underline">
                  +{order.customer.waId}
                </a>
              </>
            ) : null}
          </p>
        </section>

        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items</h3>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {order.items.map((item, idx) => (
              <li key={idx} className="flex justify-between py-2">
                <div>
                  <div>
                    {item.quantity}× {item.title}
                  </div>
                  {item.modifiers.length ? <div className="text-xs text-slate-500">{item.modifiers.map((m) => m.title).join(", ")}</div> : null}
                  {item.notes ? <div className="text-xs text-slate-500">Note: {item.notes}</div> : null}
                </div>
                <div className="whitespace-nowrap">{money(item.lineTotalMinor, order.currency)}</div>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 text-sm">
            <Row k="Subtotal" v={money(order.subtotalMinor, order.currency)} />
            {order.deliveryFeeMinor ? <Row k="Delivery" v={money(order.deliveryFeeMinor, order.currency)} /> : null}
            {order.vatMinor ? <Row k="VAT" v={money(order.vatMinor, order.currency)} /> : null}
            <Row k="Total" v={money(order.totalMinor, order.currency)} strong />
            <Row k="Payment" v={`${order.paymentMethod ?? "cash"} · ${order.paymentStatus}`} />
          </dl>
        </section>

        {loc || order.notes ? (
          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery</h3>
            {loc ? (
              <p className="mt-1 text-sm">
                {loc.address || loc.name || `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`}
                {mapLink ? (
                  <>
                    {" · "}
                    <a href={mapLink} target="_blank" rel="noreferrer" className="text-brand underline">
                      Open map
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            {loc?.notes || order.notes ? <p className="mt-1 text-sm text-slate-600">Note: {loc?.notes || order.notes}</p> : null}
          </section>
        ) : null}

        <section className="mt-8">
          <ActionButtons order={order} busy={busy} onAction={onAction} size="md" />
          {order.isTerminal ? <p className="text-sm text-slate-500">This order is {label(STATUS_LABEL, order.status).toLowerCase()}.</p> : null}
        </section>
      </aside>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : "text-slate-600"}`}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
