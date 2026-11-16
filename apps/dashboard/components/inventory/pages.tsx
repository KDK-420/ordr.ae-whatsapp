"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/suite/icons";
import { AppFrame, Card, ghostButton, inputClass, INVENTORY_NAV, Modal, primaryButton, StatCard, useLive, useSuite } from "@/components/suite/shell";
import { type Category, getCatalog, type LocalizedText, type Offering } from "@/lib/api";
import {
  invCancelPurchase,
  invCreatePurchase,
  invCreateSupplier,
  invMovements,
  invPurchases,
  invReceivePurchase,
  invRecipes,
  invReport,
  invSetRecipe,
  invSuppliers,
  invUpdateSupplier,
  type Movement,
  type Purchase,
  type RecipeLine,
  type StockRow,
  type Supplier,
  type UsageReport,
} from "@/lib/suite";
import { AdjustDialog, MOVE_LABEL, StockCountDialog, useOverview } from "./stock";

const tr = (text: LocalizedText | null | undefined) => (text ? (text.en ?? Object.values(text)[0] ?? "") : "");
const qty = (n: number) => n.toLocaleString("en-AE", { maximumFractionDigits: 2 });
const PO_TONE: Record<Purchase["status"], string> = { draft: "bg-si/10 text-si/70", ordered: "bg-amber-100 text-amber-800", received: "bg-emerald-100 text-emerald-800", cancelled: "bg-red-100 text-red-700" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Buying stock: raise an order to a supplier, then receive it to put the goods on the shelf. */
export function Purchases() {
  const { branch, money, suite } = useSuite();
  const { data, load: loadStock } = useOverview();
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([invPurchases(branch.id), invSuppliers()]);
      setPurchases(p.purchases);
      setSuppliers(s.suppliers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load purchases");
    }
  }, [branch.id]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new")) setCreating(true);
  }, []);

  const act = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn(id);
      await Promise.all([load(), loadStock()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work");
    } finally {
      setBusy(null);
    }
  };
  const itemName = (id: string) => data?.items.find((i) => i.id === id)?.name ?? "Item";
  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? "No supplier";

  return (
    <AppFrame
      nav={INVENTORY_NAV}
      module="inventory"
      title="Purchases"
      actions={
        <button onClick={() => setCreating(true)} className={`${primaryButton} flex items-center gap-1.5`}>
          <Icon name="plus" size={16} /> <span className="hidden sm:inline">Add Purchase</span>
        </button>
      }
    >
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <div className="space-y-3">
        {purchases?.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">PO-{String(p.number).padStart(4, "0")}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PO_TONE[p.status]}`}>{cap(p.status)}</span>
              <span className="text-sm text-si/60">{supplierName(p.supplierId)}</span>
              <span className="text-sm text-si/50">{new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: suite.tenant.timezone })}</span>
              <span className="ml-auto font-semibold tabular-nums">{money(p.totalMinor)}</span>
            </div>
            <p className="mt-2 text-sm text-si/70">{p.lines.map((l) => `${qty(l.quantity)} × ${itemName(l.stockItemId)}`).join(", ")}</p>
            {p.notes ? <p className="mt-1 text-sm text-si/55">{p.notes}</p> : null}
            {p.status === "draft" || p.status === "ordered" ? (
              <div className="mt-3 flex gap-2">
                <button disabled={busy === p.id} onClick={() => void act(p.id, invReceivePurchase)} className={primaryButton}>
                  Receive stock
                </button>
                <button disabled={busy === p.id} onClick={() => void act(p.id, invCancelPurchase)} className={ghostButton}>
                  Cancel
                </button>
              </div>
            ) : null}
          </Card>
        ))}
        {purchases && !purchases.length ? <Card className="p-10 text-center text-sm text-si/50">No purchases yet. Add one when you order from a supplier.</Card> : null}
      </div>
      {creating && data ? <PurchaseDialog items={data.items} suppliers={suppliers} onClose={() => setCreating(false)} onSaved={() => Promise.all([load(), loadStock()]).then(() => undefined)} /> : null}
    </AppFrame>
  );
}

function PurchaseDialog({ items, suppliers, onClose, onSaved }: { items: StockRow[]; suppliers: Supplier[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { branch, money, suite } = useSuite();
  const low = items.filter((i) => i.status !== "in_stock");
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<Array<{ stockItemId: string; quantity: string; cost: string }>>(() =>
    (low.length ? low.slice(0, 8) : items.slice(0, 1)).map((i) => ({ stockItemId: i.id, quantity: String(Math.max(1, Math.ceil(i.reorderLevel * 2 - i.onHand))), cost: (i.costMinor / 100).toFixed(2) })),
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const valid = lines.filter((l) => l.stockItemId && Number(l.quantity) > 0);
  const total = valid.reduce((n, l) => n + Math.round(Number(l.quantity) * Math.round((Number(l.cost) || 0) * 100)), 0);

  const save = async (receive: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const po = await invCreatePurchase({ branchId: branch.id, supplierId: supplierId || undefined, notes: notes.trim() || undefined, status: "ordered", lines: valid.map((l) => ({ stockItemId: l.stockItemId, quantity: Number(l.quantity), unitCostMinor: Math.round((Number(l.cost) || 0) * 100) })) });
      if (receive) await invReceivePurchase(po.id);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the purchase");
      setBusy(false);
    }
  };

  return (
    <Modal title="Add purchase" onClose={onClose} wide>
      <label className="block text-sm font-medium">
        Supplier
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
          <option value="">No supplier</option>
          {suppliers.filter((s) => s.isActive).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {low.length ? <p className="mt-2 text-xs text-si/55">Started with what is low or out. Change the quantities to what you are ordering.</p> : null}
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => {
          const item = items.find((x) => x.id === l.stockItemId);
          return (
            <div key={i} className="flex items-center gap-2">
              <select value={l.stockItemId} onChange={(e) => set(i, { stockItemId: e.target.value, cost: ((items.find((x) => x.id === e.target.value)?.costMinor ?? 0) / 100).toFixed(2) })} className="min-w-0 flex-1 rounded-lg border border-si/20 bg-white px-2 py-2 text-sm outline-none focus:border-sp" aria-label="Item">
                {items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <input value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} inputMode="decimal" className="w-16 rounded-lg border border-si/20 px-2 py-2 text-right text-sm outline-none focus:border-sp" aria-label="Quantity" title={item?.unitLabel} />
              <span className="hidden w-24 truncate text-xs text-si/55 sm:block">{item?.unitLabel}</span>
              <input value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} inputMode="decimal" className="w-20 rounded-lg border border-si/20 px-2 py-2 text-right text-sm outline-none focus:border-sp" aria-label={`Cost each in ${suite.currency}`} />
              <button onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))} className="rounded-lg p-1.5 text-si/45 hover:bg-si/5 hover:text-red-700" aria-label="Remove line">
                <Icon name="close" size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <button onClick={() => setLines((ls) => [...ls, { stockItemId: items[0]?.id ?? "", quantity: "1", cost: ((items[0]?.costMinor ?? 0) / 100).toFixed(2) }])} className="mt-2 text-sm font-semibold text-sp">
        + Add line
      </button>
      <label className="mt-3 block text-sm font-medium">
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className={inputClass} />
      </label>
      <p className="mt-3 text-right text-base font-bold">Total {money(total)}</p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button disabled={busy || !valid.length} onClick={() => void save(false)} className={ghostButton}>
          Save as ordered
        </button>
        <button disabled={busy || !valid.length} onClick={() => void save(true)} className={primaryButton}>
          Received now
        </button>
      </div>
    </Modal>
  );
}

export function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const load = useCallback(async () => {
    setSuppliers((await invSuppliers()).suppliers);
  }, []);
  useEffect(() => void load().catch(() => setSuppliers([])), [load]);
  return (
    <AppFrame
      nav={INVENTORY_NAV}
      module="inventory"
      title="Suppliers"
      actions={
        <button onClick={() => setEditing("new")} className={`${primaryButton} flex items-center gap-1.5`}>
          <Icon name="plus" size={16} /> <span className="hidden sm:inline">Add Supplier</span>
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {suppliers?.filter((s) => s.isActive).map((s) => (
          <Card key={s.id} className="p-4">
            <button onClick={() => setEditing(s)} className="text-left text-base font-semibold hover:text-sp">
              {s.name}
            </button>
            <p className="mt-1 text-sm text-si/65">{[s.phone, s.email].filter(Boolean).join(" · ") || "No contact details"}</p>
            {s.leadDays != null ? <p className="mt-1 text-xs text-si/50">Delivers in about {s.leadDays} day{s.leadDays === 1 ? "" : "s"}</p> : null}
            {s.notes ? <p className="mt-2 text-sm text-si/65">{s.notes}</p> : null}
          </Card>
        ))}
      </div>
      {suppliers && !suppliers.some((s) => s.isActive) ? <Card className="p-10 text-center text-sm text-si/50">No suppliers yet.</Card> : null}
      {editing ? <SupplierDialog supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={load} /> : null}
    </AppFrame>
  );
}

function SupplierDialog({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [leadDays, setLeadDays] = useState(supplier?.leadDays != null ? String(supplier.leadDays) : "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, notes: notes.trim() || undefined, leadDays: leadDays.trim() ? Number(leadDays) : undefined };
      if (supplier) await invUpdateSupplier(supplier.id, body);
      else await invCreateSupplier(body);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };
  return (
    <Modal title={supplier ? "Edit supplier" : "Add supplier"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label className="block text-sm font-medium">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} className={inputClass} autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            Delivery days
            <input value={leadDays} onChange={(e) => setLeadDays(e.target.value)} inputMode="numeric" className={inputClass} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputClass} />
        </label>
        <label className="block text-sm font-medium">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className={inputClass} />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-2">
          {supplier ? (
            <button type="button" onClick={() => void invUpdateSupplier(supplier.id, { isActive: false }).then(onSaved).then(onClose)} className={`${ghostButton} text-red-700`}>
              Remove
            </button>
          ) : null}
          <button type="submit" disabled={busy} className={`${primaryButton} flex-1`}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Counts, wastage and corrections: the manual side of the stock ledger. */
export function Adjustments() {
  const { branch, suite } = useSuite();
  const { data, load: loadStock } = useOverview();
  const [moves, setMoves] = useState<Movement[] | null>(null);
  const [dialog, setDialog] = useState<"adjust" | "count" | null>(null);
  const load = useCallback(() => {
    invMovements({ branchId: branch.id, types: "adjustment,wastage,count" })
      .then((r) => setMoves(r.movements))
      .catch(() => setMoves([]));
  }, [branch.id]);
  useEffect(load, [load]);
  const saved = async () => {
    await loadStock();
    load();
  };
  return (
    <AppFrame
      nav={INVENTORY_NAV}
      module="inventory"
      title="Stock Adjustments"
      actions={
        <div className="flex gap-2">
          <button onClick={() => setDialog("count")} className={ghostButton}>
            Stock Count
          </button>
          <button onClick={() => setDialog("adjust")} className={primaryButton}>
            Adjust Stock
          </button>
        </div>
      }
    >
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-si/10 text-xs uppercase tracking-wide text-si/50">
              <tr>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Item</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 text-right font-semibold">Change</th>
                <th className="px-4 py-3 font-semibold">Note</th>
                <th className="px-4 py-3 font-semibold">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-si/10">
              {moves?.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-si/70">{new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: suite.tenant.timezone })}</td>
                  <td className="px-4 py-3 font-medium">{m.itemName}</td>
                  <td className="px-4 py-3">{MOVE_LABEL[m.type]}</td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${m.units < 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {m.units > 0 ? "+" : ""}
                    {qty(m.units)} <span className="font-normal text-si/50">{m.unitLabel}</span>
                  </td>
                  <td className="px-4 py-3 text-si/70">{m.note ?? ""}</td>
                  <td className="px-4 py-3 text-si/55">{m.createdBy?.replace(/^user:/, "") ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {moves && !moves.length ? <p className="py-12 text-center text-sm text-si/50">No manual changes yet.</p> : null}
      </Card>
      {dialog === "adjust" && data ? <AdjustDialog items={data.items} onClose={() => setDialog(null)} onSaved={saved} /> : null}
      {dialog === "count" && data ? <StockCountDialog items={data.items} onClose={() => setDialog(null)} onSaved={saved} /> : null}
    </AppFrame>
  );
}

const SCOPE_LABEL = { all: "Always", takeaway: "Takeaway only", dine_in: "Dine-in only" } as const;
const BASE_LABEL = { g: "g", ml: "ml", each: "pcs" } as const;

/** What each menu item uses up when it sells: ingredients by weight, and countables such as a cup, a lid and a sleeve. */
export function Recipes() {
  const { data } = useOverview();
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lines, setLines] = useState<RecipeLine[] | null>(null);
  const [editing, setEditing] = useState<Offering | null>(null);
  const load = useCallback(async () => {
    setLines((await invRecipes()).lines);
  }, []);
  useEffect(() => {
    void load().catch(() => setLines([]));
    getCatalog()
      .then((c) => {
        setOfferings(c.offerings.filter((o) => o.isActive && o.type === "product").sort((a, b) => a.sortOrder - b.sortOrder));
        setCategories(c.categories);
      })
      .catch(() => undefined);
  }, [load]);

  const byOffering = useMemo(() => {
    const map = new Map<string, RecipeLine[]>();
    for (const l of lines ?? []) map.set(l.offeringId!, [...(map.get(l.offeringId!) ?? []), l]);
    return map;
  }, [lines]);
  const stock = data?.items ?? [];
  const describe = (o: Offering, l: RecipeLine) => {
    const item = stock.find((s) => s.id === l.stockItemId);
    const option = l.modifierOptionId ? o.modifierGroups.flatMap((g) => g.options).find((x) => x.id === l.modifierOptionId) : null;
    return `${qty(l.quantity)} ${item ? BASE_LABEL[item.baseUnit] : ""} ${item?.name ?? "item"}${option ? ` (${tr(option.name)})` : ""}${l.appliesTo && l.appliesTo !== "all" ? ` · ${SCOPE_LABEL[l.appliesTo].toLowerCase()}` : ""}`;
  };

  return (
    <AppFrame nav={INVENTORY_NAV} module="inventory" title="Recipes">
      <p className="mb-4 max-w-2xl text-sm text-si/65">Each sale takes its recipe out of stock, on every channel. Lines can depend on a choice (a large cup for the large size) or on where it is drunk (a paper cup and lid only for takeaway).</p>
      <div className="space-y-3">
        {offerings.map((o) => {
          const recipe = byOffering.get(o.id) ?? [];
          return (
            <Card key={o.id} className="flex items-start gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {tr(o.name)} <span className="ml-1 text-xs font-normal text-si/50">{tr(categories.find((c) => c.id === o.categoryId)?.name)}</span>
                </p>
                {recipe.length ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {recipe.map((l, i) => (
                      <li key={i} className="rounded-full bg-si/5 px-2.5 py-1 text-xs text-si/80">
                        {describe(o, l)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-amber-700">No recipe: sales of this item do not change stock.</p>
                )}
              </div>
              <button onClick={() => setEditing(o)} className={ghostButton}>
                Edit
              </button>
            </Card>
          );
        })}
      </div>
      {editing ? <RecipeDialog offering={editing} stock={stock} lines={byOffering.get(editing.id) ?? []} onClose={() => setEditing(null)} onSaved={load} /> : null}
    </AppFrame>
  );
}

function RecipeDialog({ offering, stock, lines, onClose, onSaved }: { offering: Offering; stock: StockRow[]; lines: RecipeLine[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState(() => lines.map((l) => ({ stockItemId: l.stockItemId, quantity: String(l.quantity), modifierOptionId: l.modifierOptionId ?? "", appliesTo: l.appliesTo ?? "all" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = offering.modifierGroups.flatMap((g) => g.options.filter((o) => o.id).map((o) => ({ id: o.id!, label: `${tr(g.name)}: ${tr(o.name)}` })));
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await invSetRecipe(
        offering.id,
        rows.filter((r) => r.stockItemId && Number(r.quantity) > 0).map((r) => ({ stockItemId: r.stockItemId, quantity: Number(r.quantity), modifierOptionId: r.modifierOptionId || undefined, appliesTo: r.appliesTo })),
      );
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recipe");
      setBusy(false);
    }
  };
  return (
    <Modal title={`Recipe: ${tr(offering.name)}`} onClose={onClose} wide>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const item = stock.find((s) => s.id === r.stockItemId);
          return (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-si/10 p-2 sm:grid-cols-[1.4fr_5.5rem_1fr_1fr_auto]">
              <select value={r.stockItemId} onChange={(e) => set(i, { stockItemId: e.target.value })} className="min-w-0 rounded-lg border border-si/20 bg-white px-2 py-2 text-sm" aria-label="Stock item">
                {stock.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-si/55">
                <input value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} inputMode="decimal" className="w-14 rounded-lg border border-si/20 px-2 py-2 text-right text-sm text-si" aria-label="Quantity" />
                {item ? BASE_LABEL[item.baseUnit] : ""}
              </label>
              <button onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))} className="rounded-lg p-1.5 text-si/45 hover:text-red-700 sm:order-last" aria-label="Remove line">
                <Icon name="close" size={16} />
              </button>
              <select value={r.modifierOptionId} onChange={(e) => set(i, { modifierOptionId: e.target.value })} className="col-span-3 min-w-0 rounded-lg border border-si/20 bg-white px-2 py-2 text-sm sm:col-span-1" aria-label="Only with this choice">
                <option value="">Every time</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    Only with {o.label}
                  </option>
                ))}
              </select>
              <select value={r.appliesTo} onChange={(e) => set(i, { appliesTo: e.target.value as "all" | "takeaway" | "dine_in" })} className="col-span-3 min-w-0 rounded-lg border border-si/20 bg-white px-2 py-2 text-sm sm:col-span-1" aria-label="When">
                {(Object.keys(SCOPE_LABEL) as Array<keyof typeof SCOPE_LABEL>).map((k) => (
                  <option key={k} value={k}>
                    {SCOPE_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        {!rows.length ? <p className="py-4 text-center text-sm text-si/50">No lines yet.</p> : null}
      </div>
      <button onClick={() => setRows((rs) => [...rs, { stockItemId: stock[0]?.id ?? "", quantity: "1", modifierOptionId: "", appliesTo: "all" }])} disabled={!stock.length} className="mt-3 text-sm font-semibold text-sp">
        + Add line
      </button>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button disabled={busy} onClick={() => void save()} className={`${primaryButton} mt-4 w-full`}>
        {busy ? "Saving…" : "Save recipe"}
      </button>
    </Modal>
  );
}

/** What stock was used, wasted and bought over a period, with its cost. */
export function InventoryReports() {
  const { branch, money } = useSuite();
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<UsageReport | null>(null);
  const load = useCallback(() => {
    const to = new Date();
    invReport({ branchId: branch.id, from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() })
      .then(setReport)
      .catch(() => setReport(null));
  }, [branch.id, days]);
  useEffect(load, [load]);
  useLive(load);
  return (
    <AppFrame
      nav={INVENTORY_NAV}
      module="inventory"
      title="Reports"
      actions={
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-si/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-sp" aria-label="Period">
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon="sale" label="Cost of stock used" value={report ? money(report.totals.usedValueMinor) : "–"} />
        <StatCard icon="trash" label="Wasted" value={report ? money(report.totals.wastedValueMinor) : "–"} tone="bad" />
        <StatCard icon="purchases" label="Purchased" value={report ? money(report.totals.purchasedValueMinor) : "–"} tone="good" />
      </div>
      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-si/10 text-xs uppercase tracking-wide text-si/50">
              <tr>
                <th className="px-4 py-3 font-semibold">Item</th>
                <th className="px-4 py-3 text-right font-semibold">Used</th>
                <th className="px-4 py-3 text-right font-semibold">Wasted</th>
                <th className="px-4 py-3 text-right font-semibold">Purchased</th>
                <th className="px-4 py-3 text-right font-semibold">Cost used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-si/10">
              {report?.rows.map((r) => (
                <tr key={r.stockItemId}>
                  <td className="px-4 py-3 font-medium">
                    {r.name} <span className="text-xs font-normal text-si/50">{r.unitLabel}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{qty(r.used)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.wasted ? qty(r.wasted) : ""}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.purchased ? qty(r.purchased) : ""}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.usedValueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report && !report.rows.length ? <p className="py-12 text-center text-sm text-si/50">No stock moved in this period.</p> : null}
      </Card>
    </AppFrame>
  );
}
