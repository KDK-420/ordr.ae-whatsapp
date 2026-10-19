"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type Category,
  createCategory,
  createOffering,
  getCatalog,
  type LocalizedText,
  type ModifierGroup,
  type Offering,
  updateCategory,
  updateOffering,
} from "@/lib/api";
import { money } from "@/lib/format";

const LANGS = [
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
];

const label = (t: LocalizedText | null | undefined) => t?.en || t?.ar || Object.values(t ?? {})[0] || "";
const toMinor = (s: string) => Math.round((Number.parseFloat(s) || 0) * 100);
const fromMinor = (n: number) => (n / 100).toFixed(2);

type Editing = { kind: "category"; item: Category | null } | { kind: "offering"; item: Offering | null } | null;

export function Catalog() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Editing>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getCatalog();
      setCategories(data.categories);
      setOfferings(data.offerings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the catalog");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const rows = filter === "all" ? offerings : filter === "none" ? offerings.filter((o) => !o.categoryId) : offerings.filter((o) => o.categoryId === filter);
    return [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [offerings, filter]);

  const count = (id: string | null) => offerings.filter((o) => (id ? o.categoryId === id : !o.categoryId)).length;

  async function toggleOffering(o: Offering) {
    try {
      const updated = await updateOffering(o.id, { isActive: !o.isActive });
      setOfferings((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Catalog</h1>
        <div className="flex items-center gap-3 text-sm">
          {error ? <span className="text-red-600">{error}</span> : null}
          <button type="button" onClick={() => setEditing({ kind: "category", item: null })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium hover:border-slate-400">
            + Category
          </button>
          <button type="button" onClick={() => setEditing({ kind: "offering", item: null })} className="rounded-md bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-dark">
            + Item
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <aside className="rounded-lg border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100 text-sm">
            <CategoryRow active={filter === "all"} onClick={() => setFilter("all")} name="All items" count={offerings.length} />
            {categories
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((c) => (
                <CategoryRow
                  key={c.id}
                  active={filter === c.id}
                  onClick={() => setFilter(c.id)}
                  name={label(c.name)}
                  count={count(c.id)}
                  muted={!c.isActive}
                  onEdit={() => setEditing({ kind: "category", item: c })}
                />
              ))}
            {count(null) > 0 ? <CategoryRow active={filter === "none"} onClick={() => setFilter("none")} name="No category" count={count(null)} muted /> : null}
          </ul>
        </aside>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Arabic</th>
                <th className="px-4 py-2 text-right">Price</th>
                <th className="px-4 py-2">Modifiers</th>
                <th className="px-4 py-2">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loaded && visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No items here yet
                  </td>
                </tr>
              ) : null}
              {visible.map((o) => (
                <tr key={o.id} className={`cursor-pointer hover:bg-slate-50 ${o.isActive ? "" : "text-slate-400"}`} onClick={() => setEditing({ kind: "offering", item: o })}>
                  <td className="px-4 py-3 font-medium">{o.name.en || label(o.name)}</td>
                  <td className="px-4 py-3" dir="rtl">
                    {o.name.ar ?? ""}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {money(o.priceMinor, o.currency)}
                    {o.durationMinutes ? <span className="ml-1 text-xs text-slate-400">· {o.durationMinutes} min</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{o.modifierGroups.length ? o.modifierGroups.map((g) => label(g.name)).join(", ") : "–"}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={o.isActive} onChange={() => void toggleOffering(o)} aria-label="Active" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {editing?.kind === "category" ? (
        <CategoryDrawer
          item={editing.item}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
      {editing?.kind === "offering" ? (
        <OfferingDrawer
          item={editing.item}
          categories={categories}
          defaultCategoryId={filter !== "all" && filter !== "none" ? filter : null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryRow({ name, count, active, muted, onClick, onEdit }: { name: string; count: number; active: boolean; muted?: boolean; onClick: () => void; onEdit?: () => void }) {
  return (
    <li className={`flex items-center ${active ? "bg-slate-100" : ""}`}>
      <button type="button" onClick={onClick} className={`flex flex-1 items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 ${muted ? "text-slate-400" : ""}`}>
        <span className="truncate">{name}</span>
        <span className="ml-2 text-xs text-slate-400">{count}</span>
      </button>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="px-3 py-2 text-xs text-slate-400 hover:text-slate-700" aria-label={`Edit ${name}`}>
          Edit
        </button>
      ) : null}
    </li>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TextFields({ value, onChange, placeholder }: { value: LocalizedText; onChange: (v: LocalizedText) => void; placeholder: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {LANGS.map((l) => (
        <input
          key={l.code}
          value={value[l.code] ?? ""}
          onChange={(e) => onChange({ ...value, [l.code]: e.target.value })}
          placeholder={`${placeholder} (${l.label})`}
          dir={l.code === "ar" ? "rtl" : "ltr"}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      ))}
    </div>
  );
}

const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

function CategoryDrawer({ item, onClose, onSaved }: { item: Category | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState<LocalizedText>(item?.name ?? {});
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { name, sortOrder: Number(sortOrder) || 0, isActive };
      if (item) await updateCategory(item.id, payload);
      else await createCategory(payload);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <Drawer title={item ? "Edit category" : "New category"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">
          Name
          <div className="mt-1">
            <TextFields value={name} onChange={setName} placeholder="Name" />
          </div>
        </label>
        <div className="flex items-end gap-4">
          <label className="block text-sm font-medium">
            Sort order
            <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={`${inputCls} mt-1 w-28`} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Shown to customers
          </label>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </Drawer>
  );
}

function OfferingDrawer({ item, categories, defaultCategoryId, onClose, onSaved }: { item: Offering | null; categories: Category[]; defaultCategoryId: string | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState<LocalizedText>(item?.name ?? {});
  const [description, setDescription] = useState<LocalizedText>(item?.description ?? {});
  const [price, setPrice] = useState(item ? fromMinor(item.priceMinor) : "");
  const [type, setType] = useState<Offering["type"]>(item?.type ?? "product");
  const [duration, setDuration] = useState(item?.durationMinutes ? String(item.durationMinutes) : "");
  const [categoryId, setCategoryId] = useState<string>(item?.categoryId ?? defaultCategoryId ?? "");
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [groups, setGroups] = useState<ModifierGroup[]>(item?.modifierGroups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o })) })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setGroup(i: number, patch: Partial<ModifierGroup>) {
    setGroups((prev) => prev.map((g, gi) => (gi === i ? { ...g, ...patch } : g)));
  }
  function setOption(gi: number, oi: number, patch: Partial<ModifierGroup["options"][number]>) {
    setGroups((prev) => prev.map((g, i) => (i === gi ? { ...g, options: g.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) } : g)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name,
        description: Object.values(description).some(Boolean) ? description : null,
        priceMinor: toMinor(price),
        type,
        durationMinutes: type === "service" ? Number(duration) || null : null,
        categoryId: categoryId || null,
        sortOrder: Number(sortOrder) || 0,
        isActive,
        modifierGroups: groups.map((g, gi) => ({
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          sortOrder: gi,
          options: g.options.map((o, oi) => ({ name: o.name, priceDeltaMinor: o.priceDeltaMinor, sortOrder: oi, isActive: o.isActive })),
        })),
      };
      if (item) await updateOffering(item.id, payload);
      else await createOffering(payload);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <Drawer title={item ? "Edit item" : "New item"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <label className="block text-sm font-medium">
          Name
          <div className="mt-1">
            <TextFields value={name} onChange={setName} placeholder="Name" />
          </div>
        </label>
        <label className="block text-sm font-medium">
          Description
          <div className="mt-1">
            <TextFields value={description} onChange={setDescription} placeholder="Description" />
          </div>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm font-medium">
            Kind
            <select value={type} onChange={(e) => setType(e.target.value as Offering["type"])} className={`${inputCls} mt-1`}>
              <option value="product">Product</option>
              <option value="service">Service</option>
            </select>
          </label>
          {type === "service" ? (
            <label className="block text-sm font-medium">
              Duration (min)
              <input type="number" min={5} step={5} required value={duration} onChange={(e) => setDuration(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
          ) : null}
          <label className="block text-sm font-medium">
            Price (AED)
            <input type="number" min={0} step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-sm font-medium">
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Sort order
            <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={`${inputCls} mt-1`} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Shown to customers
        </label>

        <fieldset className="space-y-3">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium">Modifier groups</legend>
            <button
              type="button"
              onClick={() => setGroups((prev) => [...prev, { name: {}, minSelect: 0, maxSelect: 1, options: [{ name: {}, priceDeltaMinor: 0, isActive: true }] }])}
              className="text-xs font-medium text-brand hover:underline"
            >
              + Add group
            </button>
          </div>
          {groups.length === 0 ? <p className="text-xs text-slate-500">Sizes, extras, cooking preference: anything the customer picks per item.</p> : null}
          {groups.map((g, gi) => (
            <div key={gi} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <TextFields value={g.name} onChange={(v) => setGroup(gi, { name: v })} placeholder="Group" />
                </div>
                <button type="button" onClick={() => setGroups((prev) => prev.filter((_, i) => i !== gi))} className="px-2 py-2 text-xs text-slate-400 hover:text-red-600">
                  Remove
                </button>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
                <label>
                  Min{" "}
                  <input type="number" min={0} value={g.minSelect} onChange={(e) => setGroup(gi, { minSelect: Number(e.target.value) || 0 })} className="w-14 rounded border border-slate-300 px-2 py-1" />
                </label>
                <label>
                  Max{" "}
                  <input type="number" min={1} value={g.maxSelect} onChange={(e) => setGroup(gi, { maxSelect: Math.max(1, Number(e.target.value) || 1) })} className="w-14 rounded border border-slate-300 px-2 py-1" />
                </label>
                <span className="text-slate-400">{g.minSelect > 0 ? "required" : "optional"}</span>
              </div>
              <div className="mt-3 space-y-2">
                {g.options.map((o, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <div className="flex-1">
                      <TextFields value={o.name} onChange={(v) => setOption(gi, oi, { name: v })} placeholder="Option" />
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={fromMinor(o.priceDeltaMinor)}
                      onChange={(e) => setOption(gi, oi, { priceDeltaMinor: toMinor(e.target.value) })}
                      title="Price difference (AED)"
                      className="w-20 rounded border border-slate-300 px-2 py-2 text-xs"
                    />
                    <input type="checkbox" checked={o.isActive} onChange={(e) => setOption(gi, oi, { isActive: e.target.checked })} title="Available" />
                    <button
                      type="button"
                      disabled={g.options.length <= 1}
                      onClick={() => setGroup(gi, { options: g.options.filter((_, j) => j !== oi) })}
                      className="px-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-30"
                      aria-label="Remove option"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setGroup(gi, { options: [...g.options, { name: {}, priceDeltaMinor: 0, isActive: true }] })} className="text-xs font-medium text-brand hover:underline">
                  + Add option
                </button>
              </div>
            </div>
          ))}
        </fieldset>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? "Saving…" : item ? "Save changes" : "Create item"}
        </button>
      </form>
    </Drawer>
  );
}
