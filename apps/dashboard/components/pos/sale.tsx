"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/suite/icons";
import { AppFrame, ghostButton, inputClass, Modal, POS_NAV, primaryButton, useSuite } from "@/components/suite/shell";
import { type Category, getCatalog, type LocalizedText, type Offering } from "@/lib/api";
import { type Discount, type FulfillmentType, type HeldTicket, newClientRef, posCreateOrder, posHeld, posHold, type PosOrder, posQuote, posRelease, type Quote } from "@/lib/suite";

const tr = (text: LocalizedText | null | undefined) => (text ? (text.en ?? Object.values(text)[0] ?? "") : "");

interface TicketLine {
  key: string;
  offeringId: string;
  name: string;
  quantity: number;
  optionIds: string[];
  optionNames: string[];
  unitMinor: number;
  notes?: string;
}

interface TicketState {
  lines: TicketLine[];
  type: FulfillmentType;
  table: string;
  customerName: string;
  customerPhone: string;
  discount: Discount | null;
  notes: string;
}

const EMPTY: TicketState = { lines: [], type: "pickup", table: "", customerName: "", customerPhone: "", discount: null, notes: "" };
const TYPES: Array<{ id: FulfillmentType; label: string }> = [
  { id: "pickup", label: "Takeaway" },
  { id: "dine_in", label: "Dine In" },
  { id: "delivery", label: "Delivery" },
];

const lineKey = (offeringId: string, optionIds: string[], notes?: string) => `${offeringId}|${[...optionIds].sort().join(",")}|${notes ?? ""}`;

/** The till: tap items into a ticket, hold it or take payment. Prices on screen are estimates; the server prices the sale. */
export function PosSale() {
  const { suite, branch, money } = useSuite();
  const [categories, setCategories] = useState<Category[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [ticket, setTicket] = useState<TicketState>(EMPTY);
  const [clientRef, setClientRef] = useState(newClientRef);
  const [choosing, setChoosing] = useState<Offering | null>(null);
  const [paying, setPaying] = useState(false);
  const [held, setHeld] = useState<HeldTicket[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [done, setDone] = useState<PosOrder | null>(null);

  const loadHeld = useCallback(() => {
    posHeld(branch.id)
      .then((r) => setHeld(r.tickets))
      .catch(() => undefined);
  }, [branch.id]);

  useEffect(() => {
    getCatalog()
      .then((c) => {
        setCategories(c.categories.filter((x) => x.isActive).sort((a, b) => a.sortOrder - b.sortOrder));
        setOfferings(c.offerings.filter((o) => o.isActive && o.type === "product").sort((a, b) => a.sortOrder - b.sortOrder));
        setLoaded(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the menu"));
  }, []);
  useEffect(loadHeld, [loadHeld]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return offerings.filter((o) => (category === "all" || o.categoryId === category) && (!q || tr(o.name).toLowerCase().includes(q)));
  }, [offerings, category, search]);

  const add = (offering: Offering, optionIds: string[] = [], quantity = 1, notes?: string) => {
    const options = offering.modifierGroups.flatMap((g) => g.options).filter((o) => o.id && optionIds.includes(o.id));
    const key = lineKey(offering.id, optionIds, notes);
    setTicket((t) => {
      const existing = t.lines.find((l) => l.key === key);
      const lines = existing
        ? t.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l))
        : [...t.lines, { key, offeringId: offering.id, name: tr(offering.name), quantity, optionIds, optionNames: options.map((o) => tr(o.name)), unitMinor: offering.priceMinor + options.reduce((n, o) => n + o.priceDeltaMinor, 0), notes }];
      return { ...t, lines };
    });
  };

  const tap = (offering: Offering) => {
    if (offering.modifierGroups.some((g) => g.options.some((o) => o.isActive))) setChoosing(offering);
    else add(offering);
  };

  const setQty = (key: string, delta: number) =>
    setTicket((t) => ({ ...t, lines: t.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + delta) } : l)).filter((l) => l.quantity > 0) }));

  const count = ticket.lines.reduce((n, l) => n + l.quantity, 0);
  const totals = useMemo(() => {
    const subtotal = ticket.lines.reduce((n, l) => n + l.unitMinor * l.quantity, 0);
    const discount = !ticket.discount ? 0 : Math.min(subtotal, ticket.discount.type === "percent" ? Math.round((subtotal * ticket.discount.value) / 100) : ticket.discount.value);
    const net = subtotal - discount;
    const vat = suite.vatInclusive ? Math.round(net - net / (1 + suite.vatRate)) : Math.round(net * suite.vatRate);
    return { subtotal, discount, vat, total: suite.vatInclusive ? net : net + vat };
  }, [ticket, suite.vatInclusive, suite.vatRate]);

  const reset = () => {
    setTicket(EMPTY);
    setClientRef(newClientRef());
    setShowTicket(false);
  };

  const hold = async () => {
    if (!ticket.lines.length) return;
    try {
      const label = ticket.table ? `Table ${ticket.table}` : ticket.customerName || `${count} item${count === 1 ? "" : "s"}`;
      await posHold({ branchId: branch.id, label, payload: { ticket } });
      reset();
      loadHeld();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not hold the order");
    }
  };

  const resume = async (h: HeldTicket) => {
    const saved = (h.payload as { ticket?: TicketState }).ticket;
    if (!saved) return;
    // Whatever is on the till now goes on hold first, so nothing is lost by resuming another ticket.
    if (ticket.lines.length) await hold();
    await posRelease(h.id).catch(() => undefined);
    setTicket({ ...EMPTY, ...saved });
    setClientRef(newClientRef());
    setShowHeld(false);
    loadHeld();
  };

  const orderInput = () => ({
    branchId: branch.id,
    clientRef,
    fulfillmentType: ticket.type,
    lines: ticket.lines.map((l) => ({ offeringId: l.offeringId, quantity: l.quantity, optionIds: l.optionIds, notes: l.notes })),
    discount: ticket.discount ?? undefined,
    tableLabel: ticket.type === "dine_in" && ticket.table.trim() ? ticket.table.trim() : undefined,
    contactName: ticket.customerName.trim() || undefined,
    contactPhone: ticket.customerPhone.trim() || undefined,
    notes: ticket.notes.trim() || undefined,
  });

  const panel = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-si/10 px-4 py-3">
        <h2 className="text-base font-semibold text-si">Current Order ({count})</h2>
        <div className="flex items-center gap-1">
          {held.length ? (
            <button onClick={() => setShowHeld(true)} className="rounded-lg bg-sa/40 px-2.5 py-1 text-xs font-semibold text-si">
              Held ({held.length})
            </button>
          ) : null}
          {ticket.lines.length ? (
            <button onClick={reset} className="rounded-lg p-1.5 text-si/50 hover:bg-si/5 hover:text-red-700" aria-label="Clear order" title="Clear order">
              <Icon name="trash" size={18} />
            </button>
          ) : null}
          <button onClick={() => setShowTicket(false)} className="rounded-lg p-1.5 text-si/60 hover:bg-si/5 lg:hidden" aria-label="Close order">
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-si/10 px-4 py-3">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-si/5 p-1">
          {TYPES.map((t) => (
            <button key={t.id} onClick={() => setTicket((s) => ({ ...s, type: t.id }))} className={`rounded-md py-1.5 text-xs font-semibold transition ${ticket.type === t.id ? "bg-white text-si shadow-sm" : "text-si/60"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {ticket.type === "dine_in" ? <input value={ticket.table} onChange={(e) => setTicket((s) => ({ ...s, table: e.target.value }))} placeholder="Table" className="w-20 rounded-lg border border-si/15 px-2.5 py-1.5 text-sm outline-none focus:border-sp" /> : null}
          <input value={ticket.customerName} onChange={(e) => setTicket((s) => ({ ...s, customerName: e.target.value }))} placeholder="Customer name" className="min-w-0 flex-1 rounded-lg border border-si/15 px-2.5 py-1.5 text-sm outline-none focus:border-sp" />
          <input value={ticket.customerPhone} onChange={(e) => setTicket((s) => ({ ...s, customerPhone: e.target.value }))} placeholder="Phone" inputMode="tel" className="w-32 rounded-lg border border-si/15 px-2.5 py-1.5 text-sm outline-none focus:border-sp" />
        </div>
      </div>

      <ul className="suite-scroll min-h-0 flex-1 divide-y divide-si/10 overflow-y-auto px-4">
        {ticket.lines.map((l) => (
          <li key={l.key} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-si">{l.name}</p>
              {l.optionNames.length ? <p className="truncate text-xs text-si/55">{l.optionNames.join(", ")}</p> : null}
              {l.notes ? <p className="truncate text-xs font-medium text-sp">{l.notes}</p> : null}
              <p className="mt-0.5 text-xs text-si/55">{money(l.unitMinor)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setQty(l.key, -1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-si/20 text-si hover:bg-si/5" aria-label={`One less ${l.name}`}>
                <Icon name="minus" size={14} />
              </button>
              <span className="w-6 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
              <button onClick={() => setQty(l.key, 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-sp text-white" aria-label={`One more ${l.name}`}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            <p className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-si">{money(l.unitMinor * l.quantity)}</p>
          </li>
        ))}
        {!ticket.lines.length ? <li className="py-12 text-center text-sm text-si/45">Tap an item to start an order.</li> : null}
      </ul>

      <div className="shrink-0 border-t border-si/10 px-4 py-3">
        <dl className="space-y-1 text-sm">
          <Row label="Subtotal" value={money(totals.subtotal)} />
          {totals.discount ? <Row label={`Discount${ticket.discount?.type === "percent" ? ` (${ticket.discount.value}%)` : ""}`} value={`– ${money(totals.discount)}`} /> : null}
          <Row label={`VAT (${Math.round(suite.vatRate * 100)}%)${suite.vatInclusive ? " incl." : ""}`} value={money(totals.vat)} />
          <div className="flex items-baseline justify-between pt-1.5 text-base font-bold text-si">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(totals.total)}</dd>
          </div>
        </dl>
        <button onClick={() => setEditingDiscount(true)} disabled={!ticket.lines.length} className="mt-2 text-xs font-semibold text-sp disabled:opacity-40">
          {ticket.discount ? "Change discount" : "Add discount"}
        </button>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => void hold()} disabled={!ticket.lines.length} className="rounded-xl border border-si/20 py-3 text-sm font-semibold text-si hover:bg-si/5 disabled:opacity-40">
            Hold Order
          </button>
          <button onClick={() => setPaying(true)} disabled={!ticket.lines.length} className="rounded-xl bg-sp py-3 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-40">
            Pay Now
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <AppFrame nav={POS_NAV} module="pos" fill>
      <div className="flex h-full">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 md:px-6">
            <label className="relative block">
              <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-si/40" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items" className="w-full rounded-xl border border-si/15 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-sp" />
            </label>
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {[{ id: "all", label: "All" }, ...categories.map((c) => ({ id: c.id, label: tr(c.name) }))].map((c) => (
                <button key={c.id} onClick={() => setCategory(c.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${category === c.id ? "bg-sp text-white shadow-sm" : "border border-si/15 bg-white text-si hover:bg-si/5"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {error ? <p className="mx-4 mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 md:mx-6">{error}</p> : null}
          <div className="suite-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-3 md:px-6 lg:pb-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((o) => (
                <button key={o.id} onClick={() => tap(o)} className="group overflow-hidden rounded-2xl border border-si/10 bg-white text-left transition hover:shadow-md active:scale-[0.99]">
                  <div className="aspect-[4/3] w-full bg-sa/25">
                    {o.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-full items-center justify-center font-display text-3xl text-si/25">{tr(o.name).charAt(0)}</span>
                    )}
                  </div>
                  <div className="flex items-end justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-si">{tr(o.name)}</p>
                      <p className="mt-0.5 text-sm text-si/65">{money(o.priceMinor)}</p>
                    </div>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sp text-white transition group-hover:scale-105">
                      <Icon name="plus" size={16} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {loaded && !visible.length ? <p className="py-16 text-center text-sm text-si/50">{offerings.length ? "Nothing matches." : "No items on the menu yet. Add them under Products."}</p> : null}
          </div>
        </div>

        <aside className="hidden w-[23rem] shrink-0 border-l border-si/10 lg:block">{panel}</aside>
      </div>

      {/* Phones and small tablets: the order rides in a bar at the bottom and opens as a sheet. */}
      {count > 0 && !showTicket ? (
        <button onClick={() => setShowTicket(true)} className="fixed inset-x-4 bottom-4 z-30 flex items-center justify-between rounded-2xl bg-sp px-5 py-3.5 text-white shadow-lg lg:hidden">
          <span className="text-sm font-semibold">View order ({count})</span>
          <span className="text-sm font-bold tabular-nums">{money(totals.total)}</span>
        </button>
      ) : null}
      {showTicket ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="Close order" onClick={() => setShowTicket(false)} />
          <div className="absolute inset-x-0 bottom-0 top-12 overflow-hidden rounded-t-2xl">{panel}</div>
        </div>
      ) : null}

      {choosing ? <OptionPicker offering={choosing} onClose={() => setChoosing(null)} onAdd={(ids, qty, notes) => (add(choosing, ids, qty, notes), setChoosing(null))} /> : null}
      {editingDiscount ? <DiscountDialog current={ticket.discount} onClose={() => setEditingDiscount(false)} onSave={(d) => (setTicket((t) => ({ ...t, discount: d })), setEditingDiscount(false))} /> : null}
      {showHeld ? (
        <Modal title="Held orders" onClose={() => setShowHeld(false)}>
          <ul className="divide-y divide-si/10">
            {held.map((h) => {
              const saved = (h.payload as { ticket?: TicketState }).ticket;
              const items = saved?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
              return (
                <li key={h.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{h.label ?? "Held order"}</p>
                    <p className="text-xs text-si/55">
                      {items} item{items === 1 ? "" : "s"} · {new Date(h.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <button onClick={() => void posRelease(h.id).then(loadHeld)} className="rounded-lg p-2 text-si/50 hover:bg-si/5 hover:text-red-700" aria-label="Discard">
                    <Icon name="trash" size={18} />
                  </button>
                  <button onClick={() => void resume(h)} className={primaryButton}>
                    Resume
                  </button>
                </li>
              );
            })}
            {!held.length ? <li className="py-6 text-center text-sm text-si/50">Nothing on hold.</li> : null}
          </ul>
        </Modal>
      ) : null}
      {paying ? (
        <PayDialog
          input={orderInput()}
          estimate={totals.total}
          onClose={() => setPaying(false)}
          onDone={(order) => {
            setPaying(false);
            setDone(order);
            reset();
          }}
        />
      ) : null}
      {done ? (
        <Modal title={`Order #${done.number}`} onClose={() => setDone(null)}>
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="check" size={28} />
            </span>
            <p className="mt-3 text-lg font-semibold">{done.dueMinor > 0 ? "Sent to the kitchen, not paid yet" : "Paid and sent to the kitchen"}</p>
            <p className="mt-1 text-sm text-si/60">Total {money(done.totalMinor)}</p>
            {done.payments.some((p) => (p.changeMinor ?? 0) > 0) ? <p className="mt-3 rounded-xl bg-sa/30 py-3 text-xl font-bold">Change {money(done.payments.reduce((n, p) => n + (p.changeMinor ?? 0), 0))}</p> : null}
            <button onClick={() => setDone(null)} className={`${primaryButton} mt-5 w-full py-3`} autoFocus>
              New sale
            </button>
          </div>
        </Modal>
      ) : null}
    </AppFrame>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-si/70">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Sizes, milks, extras: one sheet per item, with the rules the menu sets (pick one, pick up to three). */
function OptionPicker({ offering, onClose, onAdd }: { offering: Offering; onClose: () => void; onAdd: (optionIds: string[], quantity: number, notes?: string) => void }) {
  const { money } = useSuite();
  const groups = offering.modifierGroups.map((g) => ({ ...g, options: g.options.filter((o) => o.isActive && o.id) })).filter((g) => g.options.length);
  const [chosen, setChosen] = useState<Record<string, string[]>>(() => Object.fromEntries(groups.map((g, i) => [g.id ?? String(i), g.minSelect >= 1 ? [g.options[0]!.id!] : []])));
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const toggle = (groupKey: string, max: number, optionId: string) =>
    setChosen((c) => {
      const cur = c[groupKey] ?? [];
      if (max <= 1) return { ...c, [groupKey]: cur.includes(optionId) ? cur : [optionId] };
      if (cur.includes(optionId)) return { ...c, [groupKey]: cur.filter((x) => x !== optionId) };
      return cur.length >= max ? c : { ...c, [groupKey]: [...cur, optionId] };
    });

  const ids = Object.values(chosen).flat();
  const valid = groups.every((g, i) => (chosen[g.id ?? String(i)]?.length ?? 0) >= g.minSelect);
  const unit = offering.priceMinor + groups.flatMap((g) => g.options).filter((o) => ids.includes(o.id!)).reduce((n, o) => n + o.priceDeltaMinor, 0);
  return (
    <Modal title={tr(offering.name)} onClose={onClose}>
      <div className="space-y-4">
        {groups.map((g, i) => {
          const key = g.id ?? String(i);
          return (
            <fieldset key={key}>
              <legend className="text-sm font-semibold">
                {tr(g.name)} <span className="font-normal text-si/50">{g.minSelect >= 1 ? (g.maxSelect > 1 ? `choose ${g.minSelect} to ${g.maxSelect}` : "choose one") : g.maxSelect > 1 ? `up to ${g.maxSelect}` : "optional"}</span>
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {g.options.map((o) => {
                  const on = chosen[key]?.includes(o.id!) ?? false;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => (g.minSelect === 0 && g.maxSelect <= 1 && on ? setChosen((c) => ({ ...c, [key]: [] })) : toggle(key, g.maxSelect, o.id!))}
                      aria-pressed={on}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${on ? "border-sp bg-sp/10 font-semibold text-si" : "border-si/15 text-si/80 hover:bg-si/5"}`}
                    >
                      <span className="truncate">{tr(o.name)}</span>
                      {o.priceDeltaMinor ? <span className="shrink-0 text-xs text-si/60">+{(o.priceDeltaMinor / 100).toFixed(2)}</span> : null}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        <label className="block text-sm font-semibold">
          Note for the kitchen
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Extra hot, no sugar…" className={inputClass} />
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="flex h-10 w-10 items-center justify-center rounded-full border border-si/20" aria-label="One less">
              <Icon name="minus" size={16} />
            </button>
            <span className="w-6 text-center text-base font-semibold tabular-nums">{quantity}</span>
            <button onClick={() => setQuantity((q) => Math.min(99, q + 1))} className="flex h-10 w-10 items-center justify-center rounded-full border border-si/20" aria-label="One more">
              <Icon name="plus" size={16} />
            </button>
          </div>
          <button disabled={!valid} onClick={() => onAdd(ids, quantity, notes.trim() || undefined)} className={`${primaryButton} flex-1 py-3`}>
            Add · {money(unit * quantity)}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DiscountDialog({ current, onClose, onSave }: { current: Discount | null; onClose: () => void; onSave: (d: Discount | null) => void }) {
  const { suite } = useSuite();
  const [type, setType] = useState<Discount["type"]>(current?.type ?? "percent");
  const [value, setValue] = useState(current ? String(current.type === "amount" ? current.value / 100 : current.value) : "");
  const [reason, setReason] = useState(current?.reason ?? "");
  const n = Number(value);
  const ok = Number.isFinite(n) && n > 0 && (type === "amount" || n <= 100);
  return (
    <Modal title="Discount" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-si/5 p-1">
          {(["percent", "amount"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`rounded-md py-2 text-sm font-semibold ${type === t ? "bg-white shadow-sm" : "text-si/60"}`}>
              {t === "percent" ? "Percent" : `Amount (${suite.currency})`}
            </button>
          ))}
        </div>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={type === "percent" ? "10" : "5.00"} className={inputClass} autoFocus />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (staff meal, regular…)" maxLength={120} className={inputClass} />
        <div className="flex gap-2 pt-1">
          {current ? (
            <button onClick={() => onSave(null)} className={ghostButton}>
              Remove
            </button>
          ) : null}
          <button disabled={!ok} onClick={() => onSave({ type, value: type === "amount" ? Math.round(n * 100) : n, reason: reason.trim() || undefined })} className={`${primaryButton} flex-1`}>
            Apply
          </button>
        </div>
      </div>
    </Modal>
  );
}

type OrderInput = Parameters<typeof posCreateOrder>[0];

/** Takes the money. The amount comes from the server's quote, so the till and the receipt always agree. */
function PayDialog({ input, estimate, onClose, onDone }: { input: OrderInput; estimate: number; onClose: () => void; onDone: (order: PosOrder) => void }) {
  const { money } = useSuite();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    posQuote({ lines: input.lines, fulfillmentType: input.fulfillmentType, discount: input.discount })
      .then(setQuote)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not price the order"));
    // The ticket cannot change while this dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = quote?.totalMinor ?? estimate;
  const given = tendered.trim() ? Math.round(Number(tendered) * 100) : total;
  const short = method === "cash" && (!Number.isFinite(given) || given < total);
  const quick = [...new Set([total, ...[500, 1000, 2000, 5000, 10000, 20000].map((step) => Math.ceil(total / step) * step)])].filter((v) => v >= total).slice(0, 5);

  const submit = async (pay: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const order = await posCreateOrder({ ...input, payment: pay ? { method, tenderedMinor: method === "cash" ? given : undefined } : undefined });
      onDone(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sale did not go through. Try again.");
      setBusy(false);
    }
  };

  return (
    <Modal title="Payment" onClose={onClose}>
      <p className="text-center text-sm text-si/60">Amount due</p>
      <p className="text-center text-4xl font-bold tabular-nums">{quote ? money(total) : "…"}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {(["cash", "card"] as const).map((m) => (
          <button key={m} onClick={() => setMethod(m)} aria-pressed={method === m} className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold ${method === m ? "border-sp bg-sp/10" : "border-si/15 text-si/70"}`}>
            <Icon name={m} /> {m === "cash" ? "Cash" : "Card"}
          </button>
        ))}
      </div>
      {method === "cash" ? (
        <div className="mt-4">
          <p className="text-sm font-semibold">Cash received</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {quick.map((v, i) => (
              <button key={v} onClick={() => setTendered((v / 100).toFixed(2))} className={`rounded-lg border px-3 py-2 text-sm font-semibold tabular-nums ${given === v ? "border-sp bg-sp/10" : "border-si/15"}`}>
                {i === 0 ? "Exact" : (v / 100).toFixed(0)}
              </button>
            ))}
          </div>
          <input value={tendered} onChange={(e) => setTendered(e.target.value)} inputMode="decimal" placeholder={(total / 100).toFixed(2)} className={inputClass} aria-label="Cash received" />
          <p className={`mt-2 text-sm font-semibold ${short ? "text-red-700" : "text-emerald-700"}`}>{short ? "That is less than the total." : `Change ${money(given - total)}`}</p>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-si/5 px-3 py-2.5 text-sm text-si/70">Take the card on your terminal, then confirm here.</p>
      )}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <button disabled={busy || !quote || short} onClick={() => void submit(true)} className={`${primaryButton} mt-5 w-full py-3.5 text-base`}>
        {busy ? "Working…" : `Charge ${quote ? money(total) : ""}`}
      </button>
      <button disabled={busy || !quote} onClick={() => void submit(false)} className="mt-2 w-full py-2 text-sm font-semibold text-si/70 hover:text-si disabled:opacity-50">
        Send to kitchen, pay later
      </button>
    </Modal>
  );
}
