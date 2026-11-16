"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/suite/icons";
import { AppFrame, Card, ghostButton, inputClass, Modal, POS_NAV, primaryButton, StatCard, useLive, useSuite } from "@/components/suite/shell";
import { type DayReport, orderEvent, type PosCustomer, posCustomers, type PosOrder, posOrders, posPay, posReport } from "@/lib/suite";

const TYPE_LABEL: Record<string, string> = { dine_in: "Dine In", pickup: "Takeaway", delivery: "Delivery" };
const SOURCE_LABEL: Record<string, string> = { pos: "Till", web: "Online store", whatsapp: "WhatsApp", webchat: "Web chat" };
const STATUS_TONE: Record<string, string> = {
  placed: "bg-sp/15 text-sp",
  accepted: "bg-sp/15 text-sp",
  preparing: "bg-amber-100 text-amber-800",
  ready: "bg-emerald-100 text-emerald-800",
  out_for_delivery: "bg-sky-100 text-sky-800",
  delivered: "bg-si/10 text-si/70",
  completed: "bg-si/10 text-si/70",
  cancelled: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};
const CLOSED = new Set(["completed", "delivered", "cancelled", "rejected"]);
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const today = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

function DayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="rounded-lg border border-si/15 bg-white px-3 py-1.5 text-sm text-si outline-none focus:border-sp" aria-label="Day" />;
}

/** Every order of the day at this branch, from the till, the online store and WhatsApp alike. */
export function PosOrders() {
  const { suite, branch, money } = useSuite();
  const [date, setDate] = useState(() => today(suite.tenant.timezone));
  const [orders, setOrders] = useState<PosOrder[] | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "unpaid">("all");
  const [open, setOpen] = useState<PosOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await posOrders({ branchId: branch.id, date });
      setOrders(r.orders);
      setOpen((cur) => (cur ? (r.orders.find((o) => o.id === cur.id) ?? cur) : cur));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders");
    }
  }, [branch.id, date]);
  useEffect(() => void load(), [load]);
  useLive(() => void load());

  const rows = (orders ?? []).filter((o) => (filter === "open" ? !CLOSED.has(o.status) : filter === "unpaid" ? o.dueMinor > 0 && o.status !== "cancelled" && o.status !== "rejected" : true));
  return (
    <AppFrame nav={POS_NAV} module="pos" title="Orders" actions={<DayPicker value={date} onChange={setDate} />}>
      <div className="mb-4 flex gap-2">
        {(["all", "open", "unpaid"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${filter === f ? "bg-sp text-white" : "border border-si/15 bg-white text-si"}`}>
            {f === "all" ? "All" : f === "open" ? "In progress" : "Unpaid"}
          </button>
        ))}
      </div>
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-si/10 text-xs uppercase tracking-wide text-si/50">
              <tr>
                <th className="px-4 py-3 font-semibold">Order</th>
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">From</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-si/10">
              {rows.map((o) => (
                <tr key={o.id} onClick={() => setOpen(o)} className="cursor-pointer hover:bg-si/[0.03]">
                  <td className="px-4 py-3 font-semibold">
                    #{o.number}
                    <span className="ml-2 font-normal text-si/55">{o.tableLabel ? `Table ${o.tableLabel}` : (o.contactName ?? o.customerName ?? "")}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-si/70">{new Date(o.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: suite.tenant.timezone })}</td>
                  <td className="px-4 py-3">{TYPE_LABEL[o.fulfillmentType] ?? o.fulfillmentType}</td>
                  <td className="px-4 py-3 text-si/70">{SOURCE_LABEL[o.source] ?? o.source}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[o.status] ?? "bg-si/10"}`}>{label(o.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(o.totalMinor)}</td>
                  <td className="px-4 py-3">{o.dueMinor > 0 ? <span className="font-semibold text-amber-700">Due {money(o.dueMinor)}</span> : <span className="text-emerald-700">Paid{o.paymentMethod ? ` · ${o.paymentMethod}` : ""}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders && !rows.length ? <p className="py-12 text-center text-sm text-si/50">No orders here yet.</p> : null}
      </Card>
      {open ? <OrderDialog order={open} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </AppFrame>
  );
}

function OrderDialog({ order, onClose, onChanged }: { order: PosOrder; onClose: () => void; onChanged: () => Promise<void> }) {
  const { money } = useSuite();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work");
    } finally {
      setBusy(false);
    }
  };
  const closed = CLOSED.has(order.status);
  return (
    <Modal title={`Order #${order.number}`} onClose={onClose}>
      <p className="text-sm text-si/60">
        {TYPE_LABEL[order.fulfillmentType] ?? order.fulfillmentType} · {SOURCE_LABEL[order.source] ?? order.source} · <span className="font-semibold text-si">{label(order.status)}</span>
      </p>
      {order.contactName || order.contactPhone ? <p className="mt-1 text-sm text-si/60">{[order.contactName, order.contactPhone].filter(Boolean).join(" · ")}</p> : null}
      <ul className="mt-4 divide-y divide-si/10 border-y border-si/10">
        {order.items.map((l, i) => (
          <li key={i} className="flex gap-3 py-2.5 text-sm">
            <span className="w-7 font-semibold tabular-nums">{l.quantity}×</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{l.title}</span>
              {l.modifiers.length ? <span className="block text-xs text-si/55">{l.modifiers.map((m) => m.title).join(", ")}</span> : null}
              {l.notes ? <span className="block text-xs text-sp">{l.notes}</span> : null}
            </span>
            <span className="tabular-nums">{money(l.lineTotalMinor)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 text-sm text-si/70">
        <Line k="Subtotal" v={money(order.subtotalMinor)} />
        {order.discountMinor ? <Line k="Discount" v={`– ${money(order.discountMinor)}`} /> : null}
        {order.deliveryFeeMinor ? <Line k="Delivery" v={money(order.deliveryFeeMinor)} /> : null}
        <Line k="VAT" v={money(order.vatMinor)} />
        <div className="flex justify-between pt-1 text-base font-bold text-si">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(order.totalMinor)}</dd>
        </div>
        {order.payments.map((p) => (
          <Line key={p.id} k={`Paid by ${p.method}`} v={money(p.amountMinor)} />
        ))}
        {order.dueMinor > 0 ? <Line k="Still due" v={money(order.dueMinor)} /> : null}
      </dl>
      {order.notes ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{order.notes}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {order.dueMinor > 0 && order.status !== "cancelled" && order.status !== "rejected" ? (
          <>
            <button disabled={busy} onClick={() => void run(() => posPay(order.id, { method: "cash" }))} className={`${primaryButton} flex flex-1 items-center justify-center gap-2`}>
              <Icon name="cash" size={18} /> Paid in cash
            </button>
            <button disabled={busy} onClick={() => void run(() => posPay(order.id, { method: "card" }))} className={`${primaryButton} flex flex-1 items-center justify-center gap-2`}>
              <Icon name="card" size={18} /> Paid by card
            </button>
          </>
        ) : null}
        {!closed ? (
          <button disabled={busy} onClick={() => window.confirm(`Cancel order #${order.number}? Stock taken for it goes back.`) && void run(() => orderEvent(order.id, "cancel"))} className={`${ghostButton} text-red-700`}>
            Cancel order
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

/** People who ordered with a phone number, most recent first. */
export function PosCustomers() {
  const { money, suite } = useSuite();
  const [customers, setCustomers] = useState<PosCustomer[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    posCustomers()
      .then((r) => setCustomers(r.customers))
      .catch(() => setCustomers([]));
  }, []);
  const needle = q.trim().toLowerCase();
  const rows = (customers ?? []).filter((c) => !needle || c.name?.toLowerCase().includes(needle) || c.phone?.includes(needle.replace(/\D/g, "") || "~"));
  return (
    <AppFrame nav={POS_NAV} module="pos" title="Customers">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone" className={`${inputClass} mb-4 mt-0 max-w-sm`} />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-si/10 text-xs uppercase tracking-wide text-si/50">
              <tr>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 text-right font-semibold">Orders</th>
                <th className="px-4 py-3 text-right font-semibold">Spent</th>
                <th className="px-4 py-3 font-semibold">Last order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-si/10">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-semibold">{c.name ?? "No name"}</td>
                  <td className="px-4 py-3 tabular-nums text-si/70">{c.phone ? `+${c.phone}` : ""}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.orders}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(c.spentMinor)}</td>
                  <td className="px-4 py-3 text-si/70">{new Date(c.lastOrderAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: suite.tenant.timezone })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {customers && !rows.length ? <p className="px-6 py-12 text-center text-sm text-si/50">Customers appear here once an order is taken with a phone number.</p> : null}
      </Card>
    </AppFrame>
  );
}

/** The day's numbers for one branch: sales, how they were paid, where they came from, what sold. */
export function PosReports() {
  const { suite, branch, money } = useSuite();
  const [date, setDate] = useState(() => today(suite.tenant.timezone));
  const [report, setReport] = useState<DayReport | null>(null);
  const load = useCallback(() => {
    posReport({ branchId: branch.id, date })
      .then(setReport)
      .catch(() => setReport(null));
  }, [branch.id, date]);
  useEffect(load, [load]);
  useLive(load);

  const max = Math.max(1, ...(report?.topItems.map((i) => i.quantity) ?? [1]));
  return (
    <AppFrame nav={POS_NAV} module="pos" title="Reports" actions={<DayPicker value={date} onChange={setDate} />}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="reports" label="Sales" value={report ? money(report.grossMinor) : "–"} hint={report ? `VAT ${money(report.vatMinor)}` : undefined} />
        <StatCard icon="orders" label="Orders" value={report?.orders ?? "–"} hint={report?.cancelled ? `${report.cancelled} cancelled` : undefined} />
        <StatCard icon="sale" label="Average order" value={report ? money(report.averageMinor) : "–"} />
        <StatCard icon="cash" label="Collected" value={report ? money(report.collectedMinor) : "–"} hint={report?.unpaidMinor ? `${money(report.unpaidMinor)} unpaid` : undefined} tone={report?.unpaidMinor ? "warn" : "good"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold">Top items</h2>
          <ul className="mt-3 space-y-2.5">
            {report?.topItems.map((i) => (
              <li key={i.title} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="truncate font-medium">{i.title}</span>
                  <span className="shrink-0 tabular-nums text-si/70">
                    {i.quantity} · {money(i.grossMinor)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-si/10">
                  <div className="h-1.5 rounded-full bg-sp" style={{ width: `${(i.quantity / max) * 100}%` }} />
                </div>
              </li>
            ))}
            {report && !report.topItems.length ? <li className="py-6 text-center text-sm text-si/50">No sales on this day.</li> : null}
          </ul>
        </Card>
        <div className="space-y-4">
          <Breakdown title="By payment" rows={report?.byMethod.map((m) => ({ k: label(m.method), n: m.count, v: money(m.amountMinor) })) ?? []} />
          <Breakdown title="By channel" rows={report?.bySource.map((s) => ({ k: SOURCE_LABEL[s.source] ?? s.source, n: s.orders, v: money(s.grossMinor) })) ?? []} />
          <Breakdown title="By type" rows={report?.byType.map((t) => ({ k: TYPE_LABEL[t.type] ?? t.type, n: t.orders, v: money(t.grossMinor) })) ?? []} />
        </div>
      </div>
    </AppFrame>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ k: string; n: number; v: string }> }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.k} className="flex justify-between gap-3">
            <span>
              {r.k} <span className="text-si/45">({r.n})</span>
            </span>
            <span className="font-semibold tabular-nums">{r.v}</span>
          </li>
        ))}
        {!rows.length ? <li className="text-si/45">Nothing yet</li> : null}
      </ul>
    </Card>
  );
}
