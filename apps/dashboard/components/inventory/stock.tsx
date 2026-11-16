"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/suite/icons";
import { AppFrame, Card, ghostButton, inputClass, INVENTORY_NAV, Modal, primaryButton, StatCard, useLive, useSuite } from "@/components/suite/shell";
import { type BaseUnit, invAdjust, invCreateItem, invMovements, invOverview, invUpdateItem, type InventoryOverview, type Movement, STOCK_KINDS, type StockKind, type StockRow } from "@/lib/suite";

export const STATUS: Record<StockRow["status"], { label: string; className: string }> = {
  in_stock: { label: "In Stock", className: "bg-emerald-100 text-emerald-800" },
  low: { label: "Low Stock", className: "bg-amber-100 text-amber-800" },
  out: { label: "Out of Stock", className: "bg-red-100 text-red-700" },
};
export const MOVE_LABEL: Record<Movement["type"], string> = { sale: "Sale", sale_reversal: "Sale cancelled", purchase: "Purchase", adjustment: "Adjustment", wastage: "Wastage", count: "Stock count" };
const qty = (n: number) => n.toLocaleString("en-AE", { maximumFractionDigits: 2 });
/** "22 pieces" for a one-word unit, "23.9 × 1kg bag" for a sized one. */
export const onHandText = (row: Pick<StockRow, "onHand" | "unitLabel">) => {
  const label = row.unitLabel.trim();
  if (!label) return qty(row.onHand);
  if (/[\s\d]/.test(label)) return `${qty(row.onHand)} × ${label}`;
  return `${qty(row.onHand)} ${label}${row.onHand === 1 || label.endsWith("s") ? "" : "s"}`;
};

export function useOverview() {
  const { branch } = useSuite();
  const [data, setData] = useState<InventoryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await invOverview(branch.id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load stock");
    }
  }, [branch.id]);
  useEffect(() => void load(), [load]);
  useLive(() => void load());
  return { data, error, load };
}

export function Totals({ data }: { data: InventoryOverview | null }) {
  const { money } = useSuite();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard icon="inventory" label="Total Items" value={data?.totals.items ?? "–"} />
      <StatCard icon="cash" label="In Stock Value" value={data ? money(data.totals.valueMinor) : "–"} tone="good" />
      <StatCard icon="alert" label="Low Stock" value={data?.totals.low ?? "–"} tone="warn" />
      <StatCard icon="close" label="Out of Stock" value={data?.totals.out ?? "–"} tone="bad" />
    </div>
  );
}

/** Inventory home: the four numbers, what needs buying, and what moved lately. */
export function InventoryDashboard() {
  const { base, branch, suite } = useSuite();
  const { data, error, load } = useOverview();
  const [moves, setMoves] = useState<Movement[]>([]);
  const [dialog, setDialog] = useState<"count" | "adjust" | null>(null);
  const loadMoves = useCallback(() => {
    invMovements({ branchId: branch.id })
      .then((r) => setMoves(r.movements.slice(0, 12)))
      .catch(() => undefined);
  }, [branch.id]);
  useEffect(loadMoves, [loadMoves]);
  useLive(loadMoves);

  const attention = (data?.items ?? []).filter((i) => i.status !== "in_stock").sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "out" ? -1 : 1));
  const refresh = async () => {
    await load();
    loadMoves();
  };
  return (
    <AppFrame nav={INVENTORY_NAV} module="inventory" title="Inventory">
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <Totals data={data} />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <button onClick={() => setDialog("count")} className="flex flex-col items-center gap-2 rounded-2xl bg-sp px-3 py-4 text-sm font-semibold text-white shadow-sm sm:flex-row sm:justify-center">
          <Icon name="recipes" /> Stock Count
        </button>
        <Link href={`${base}/inventory/purchases?new=1`} className="flex flex-col items-center gap-2 rounded-2xl border border-si/15 bg-white px-3 py-4 text-sm font-semibold text-si sm:flex-row sm:justify-center">
          <Icon name="purchases" /> Add Purchase
        </Link>
        <button onClick={() => setDialog("adjust")} className="flex flex-col items-center gap-2 rounded-2xl border border-si/15 bg-white px-3 py-4 text-sm font-semibold text-si sm:flex-row sm:justify-center">
          <Icon name="adjustments" /> Adjust Stock
        </button>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Needs attention</h2>
            <Link href={`${base}/inventory/items`} className="text-xs font-semibold text-sp">
              All items
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-si/10">
            {attention.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.name}</p>
                  <p className="text-xs text-si/55">
                    {onHandText(i)} · reorder at {qty(i.reorderLevel)}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[i.status].className}`}>{STATUS[i.status].label}</span>
              </li>
            ))}
            {data && !attention.length ? <li className="py-8 text-center text-sm text-si/50">Everything is above its reorder level.</li> : null}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Recent stock movement</h2>
          <ul className="mt-2 divide-y divide-si/10">
            {moves.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.itemName}</p>
                  <p className="text-xs text-si/55">
                    {MOVE_LABEL[m.type]} · {new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: suite.tenant.timezone })}
                  </p>
                </div>
                <span className={`font-semibold tabular-nums ${m.units < 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {m.units > 0 ? "+" : ""}
                  {qty(m.units)}
                </span>
              </li>
            ))}
            {!moves.length ? <li className="py-8 text-center text-sm text-si/50">Sales, purchases and counts show up here.</li> : null}
          </ul>
        </Card>
      </div>
      {dialog === "count" && data ? <StockCountDialog items={data.items} onClose={() => setDialog(null)} onSaved={refresh} /> : null}
      {dialog === "adjust" && data ? <AdjustDialog items={data.items} onClose={() => setDialog(null)} onSaved={refresh} /> : null}
    </AppFrame>
  );
}

/** The stock list: everything the restaurant keeps, from beans and milk to cups, lids and bags. */
export function StockItems() {
  const { data, error, load } = useOverview();
  const [tab, setTab] = useState<"all" | "low" | "out">("all");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<StockRow | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => (tab === "all" || i.status === tab) && (!category || i.category === category) && (!needle || i.name.toLowerCase().includes(needle)));
  }, [data, tab, q, category]);

  return (
    <AppFrame nav={INVENTORY_NAV} module="inventory" title="Inventory">
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <Totals data={data} />
      <Card className="mt-4 overflow-hidden">
        <div className="flex gap-6 border-b border-si/10 px-4">
          {(
            [
              ["all", "Stock Items"],
              ["low", "Low Stock"],
              ["out", "Out of Stock"],
            ] as const
          ).map(([id, text]) => (
            <button key={id} onClick={() => setTab(id)} className={`-mb-px border-b-2 py-3 text-sm font-semibold ${tab === id ? "border-sp text-sp" : "border-transparent text-si/55 hover:text-si"}`}>
              {text}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <label className="relative min-w-[12rem] flex-1">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-si/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" className="w-full rounded-lg border border-si/15 py-2 pl-9 pr-3 text-sm outline-none focus:border-sp" />
          </label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-si/15 bg-white px-3 py-2 text-sm outline-none focus:border-sp" aria-label="Category">
            <option value="">All categories</option>
            {data?.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button onClick={() => setEditing("new")} className={`${primaryButton} flex items-center gap-1.5`}>
            <Icon name="plus" size={16} /> Add Item
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-y border-si/10 bg-si/[0.03] text-xs uppercase tracking-wide text-si/50">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Item</th>
                <th className="px-4 py-2.5 font-semibold">Category</th>
                <th className="px-4 py-2.5 text-right font-semibold">In Stock</th>
                <th className="px-4 py-2.5 text-right font-semibold">Reorder Level</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-si/10">
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-si/[0.03]">
                  <td className="px-4 py-3">
                    <button onClick={() => setEditing(i)} className="text-left font-semibold hover:text-sp">
                      {i.name}
                    </button>
                    <span className="block text-xs text-si/50">{STOCK_KINDS[i.kind].split(" (")[0]}</span>
                  </td>
                  <td className="px-4 py-3 text-si/70">{i.category ?? ""}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{onHandText(i)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-si/70">{qty(i.reorderLevel)}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[i.status].className}`}>{STATUS[i.status].label}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setAdjusting(i)} className="rounded-lg border border-si/15 px-2.5 py-1 text-xs font-semibold hover:bg-si/5">
                      Adjust
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && !rows.length ? <p className="py-12 text-center text-sm text-si/50">{data.items.length ? "Nothing matches." : "No stock items yet. Add your first one."}</p> : null}
      </Card>
      {editing ? <ItemDialog item={editing === "new" ? null : editing} categories={data?.categories ?? []} onClose={() => setEditing(null)} onSaved={load} /> : null}
      {adjusting && data ? <AdjustDialog items={data.items} preset={adjusting.id} onClose={() => setAdjusting(null)} onSaved={load} /> : null}
    </AppFrame>
  );
}

const UNIT_HINT: Record<BaseUnit, string> = { g: "grams", ml: "millilitres", each: "pieces" };

function ItemDialog({ item, categories, onClose, onSaved }: { item: StockRow | null; categories: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { suite, branch } = useSuite();
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [kind, setKind] = useState<StockKind>(item?.kind ?? "ingredient");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(item?.baseUnit ?? "each");
  const [unitLabel, setUnitLabel] = useState(item?.unitLabel ?? "");
  const [unitSize, setUnitSize] = useState(String(item?.unitSize ?? 1));
  const [reorder, setReorder] = useState(String(item?.reorderLevel ?? 0));
  const [cost, setCost] = useState(item ? (item.costMinor / 100).toFixed(2) : "");
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), category: category.trim() || null, kind, baseUnit, unitLabel: unitLabel.trim() || undefined, unitSize: Number(unitSize) || 1, reorderLevel: Number(reorder) || 0, costMinor: Math.round((Number(cost) || 0) * 100) };
      if (item) await invUpdateItem(item.id, body);
      else await invCreateItem({ ...body, branchId: branch.id, openingStock: opening.trim() ? Number(opening) : undefined });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <Modal title={item ? "Edit item" : "Add item"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label className="block text-sm font-medium">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="12oz paper cup" className={inputClass} autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Category
            <input value={category} onChange={(e) => setCategory(e.target.value)} list="stock-categories" placeholder="Packaging" className={inputClass} />
            <datalist id="stock-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block text-sm font-medium">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as StockKind)} className={inputClass}>
              {(Object.keys(STOCK_KINDS) as StockKind[]).map((k) => (
                <option key={k} value={k}>
                  {STOCK_KINDS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm font-medium">
            Measured in
            <select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value as BaseUnit)} className={inputClass} disabled={!!item}>
              <option value="each">Pieces</option>
              <option value="g">Grams</option>
              <option value="ml">Millilitres</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Bought as
            <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="sleeve of 50" maxLength={40} className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            {UNIT_HINT[baseUnit]} in one
            <input value={unitSize} onChange={(e) => setUnitSize(e.target.value)} inputMode="decimal" className={inputClass} disabled={!!item} />
          </label>
        </div>
        <p className="text-xs text-si/55">Stock is counted in what you buy (a sleeve, a 1kg bag, a litre). Recipes use {UNIT_HINT[baseUnit]}, so one coffee can take 18 g of beans or one cup.</p>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm font-medium">
            Cost ({suite.currency})
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            Reorder level
            <input value={reorder} onChange={(e) => setReorder(e.target.value)} inputMode="decimal" className={inputClass} />
          </label>
          {!item ? (
            <label className="block text-sm font-medium">
              In stock now
              <input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" placeholder="0" className={inputClass} />
            </label>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-2 pt-1">
          {item ? (
            <button type="button" disabled={busy} onClick={() => window.confirm(`Stop tracking ${item.name}?`) && void invUpdateItem(item.id, { isActive: false }).then(onSaved).then(onClose)} className={`${ghostButton} text-red-700`}>
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

const ADJUST_TYPES = [
  { id: "count", label: "Count", hint: "Set the level to what you counted." },
  { id: "wastage", label: "Wastage", hint: "Spilled, expired, broken. Removes stock and is reported as waste." },
  { id: "adjustment", label: "Add or remove", hint: "A correction. Use a minus for removing." },
] as const;

export function AdjustDialog({ items, preset, onClose, onSaved }: { items: StockRow[]; preset?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { branch } = useSuite();
  const [itemId, setItemId] = useState(preset ?? items[0]?.id ?? "");
  const [type, setType] = useState<(typeof ADJUST_TYPES)[number]["id"]>("count");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = items.find((i) => i.id === itemId);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await invAdjust({ branchId: branch.id, stockItemId: itemId, type, quantity: Number(quantity), note: note.trim() || undefined });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label className="block text-sm font-medium">
          Item
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputClass}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        {item ? <p className="text-sm text-si/60">In stock now: {onHandText(item)}</p> : null}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-si/5 p-1">
          {ADJUST_TYPES.map((t) => (
            <button key={t.id} type="button" onClick={() => setType(t.id)} className={`rounded-md py-2 text-xs font-semibold ${type === t.id ? "bg-white shadow-sm" : "text-si/60"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-si/55">{ADJUST_TYPES.find((t) => t.id === type)!.hint}</p>
        <label className="block text-sm font-medium">
          {type === "count" ? "Counted" : "Quantity"} {item ? `(${item.unitLabel})` : ""}
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} required inputMode="decimal" className={inputClass} autoFocus />
        </label>
        <label className="block text-sm font-medium">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={inputClass} />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button type="submit" disabled={busy || !itemId || !quantity.trim() || !Number.isFinite(Number(quantity))} className={`${primaryButton} w-full`}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}

/** Count the whole store room in one go: fill in what you counted, leave the rest blank. */
export function StockCountDialog({ items, onClose, onSaved }: { items: StockRow[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { branch } = useSuite();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = Object.entries(counted).filter(([, v]) => v.trim() && Number.isFinite(Number(v)) && Number(v) >= 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const [stockItemId, v] of filled) await invAdjust({ branchId: branch.id, stockItemId, type: "count", quantity: Number(v), note: "Stock count" });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the count");
      setBusy(false);
    }
  };

  return (
    <Modal title="Stock count" onClose={onClose} wide>
      <ul className="divide-y divide-si/10">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{i.name}</p>
              <p className="text-xs text-si/55">System: {onHandText(i)}</p>
            </div>
            <input value={counted[i.id] ?? ""} onChange={(e) => setCounted((c) => ({ ...c, [i.id]: e.target.value }))} inputMode="decimal" placeholder="Counted" className="w-28 rounded-lg border border-si/20 px-3 py-2 text-right text-sm outline-none focus:border-sp" aria-label={`Counted ${i.name}`} />
          </li>
        ))}
      </ul>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <button disabled={busy || !filled.length} onClick={() => void save()} className={`${primaryButton} mt-4 w-full`}>
        {busy ? "Saving…" : `Save ${filled.length || ""} count${filled.length === 1 ? "" : "s"}`}
      </button>
    </Modal>
  );
}
