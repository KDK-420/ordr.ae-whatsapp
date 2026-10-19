"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, createResource, getCatalog, type LocalizedText, listResources, type Offering, type Resource, type ResourceInput, updateResource, WEEKDAYS, type Weekday, type WeeklyHours } from "@/lib/api";
import { localized } from "@/lib/format";

const DAY_LABEL: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

function summarizeHours(hours: WeeklyHours): string {
  const parts = WEEKDAYS.filter((d) => (hours[d] ?? []).length).map((d) => `${DAY_LABEL[d]} ${(hours[d] ?? []).map((r) => `${r.start}–${r.end}`).join(", ")}`);
  return parts.length ? parts.join(" · ") : "No hours set";
}

export default function TeamPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [services, setServices] = useState<Offering[]>([]);
  const [editing, setEditing] = useState<Resource | "new" | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([listResources(), getCatalog()]);
      setResources(r.resources);
      setServices(c.offerings.filter((o) => o.type === "service"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the team");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle(r: Resource) {
    try {
      const updated = await updateResource(r.id, { isActive: !r.isActive });
      setResources((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Team and hours</h1>
          <p className="mt-2 text-sm text-slate-600">Who (or what) customers book: stylists, rooms, chairs. Hours are in the salon's timezone; skills limit which services each one offers.</p>
        </div>
        <button type="button" onClick={() => setEditing("new")} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          Add
        </button>
      </div>
      {forbidden ? <p className="mt-3 text-sm text-amber-700">Only owners can change the team.</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Hours</th>
              <th className="px-4 py-2">Services</th>
              <th className="px-4 py-2">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {resources.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Nobody yet. Add your first team member.
                </td>
              </tr>
            ) : null}
            {resources.map((r) => (
              <tr key={r.id} className={`cursor-pointer hover:bg-slate-50 ${r.isActive ? "" : "text-slate-400"}`} onClick={() => setEditing(r)}>
                <td className="px-4 py-3 font-medium">
                  {localized(r.name)}
                  {r.name.ar ? (
                    <span className="ml-2 text-xs text-slate-400" dir="rtl">
                      {r.name.ar}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 capitalize">{r.type}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{summarizeHours(r.hours)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {r.skills.length ? r.skills.map((id) => localized(services.find((s) => s.id === id)?.name ?? { en: id })).join(", ") : "All services"}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()} onKeyDown={() => undefined}>
                  <input type="checkbox" checked={r.isActive} onChange={() => void toggle(r)} aria-label="Active" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <ResourceDrawer
          item={editing === "new" ? null : editing}
          services={services}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
          onForbidden={() => setForbidden(true)}
        />
      ) : null}
    </div>
  );
}

function ResourceDrawer({ item, services, onClose, onSaved, onForbidden }: { item: Resource | null; services: Offering[]; onClose: () => void; onSaved: () => Promise<void>; onForbidden: () => void }) {
  const [name, setName] = useState<LocalizedText>(item?.name ?? {});
  const [type, setType] = useState<Resource["type"]>(item?.type ?? "staff");
  const [hours, setHours] = useState<WeeklyHours>(item?.hours ?? {});
  const [skills, setSkills] = useState<string[]>(item?.skills ?? []);
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setDay(day: Weekday, ranges: Array<{ start: string; end: string }> | null) {
    setHours((prev) => {
      const next = { ...prev };
      if (ranges) next[day] = ranges;
      else delete next[day];
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: ResourceInput = { name, type, hours, skills, sortOrder: Number(sortOrder) || 0, isActive };
    try {
      if (item) await updateResource(item.id, payload);
      else await createResource(payload);
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        onForbidden();
        onClose();
      } else setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()} role="presentation">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} onKeyDown={() => undefined} role="presentation">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{item ? "Edit" : "New team member"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-medium">
              Name (English)
              <input required value={name.en ?? ""} onChange={(e) => setName({ ...name, en: e.target.value })} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-sm font-medium">
              Name (Arabic)
              <input dir="rtl" value={name.ar ?? ""} onChange={(e) => setName({ ...name, ar: e.target.value })} className={`${inputCls} mt-1`} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm font-medium">
              Type
              <select value={type} onChange={(e) => setType(e.target.value as Resource["type"])} className={`${inputCls} mt-1`}>
                <option value="staff">Staff</option>
                <option value="room">Room</option>
                <option value="asset">Chair / asset</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Order
              <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Bookable
            </label>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Weekly hours</legend>
            <p className="text-xs text-slate-500">Untick a day to close it. "Anyone available" picks the first person in order who is free.</p>
            <div className="mt-2 space-y-1.5">
              {WEEKDAYS.map((d) => {
                const ranges = hours[d] ?? [];
                const open = ranges.length > 0;
                const first = ranges[0] ?? { start: "10:00", end: "20:00" };
                return (
                  <div key={d} className="flex items-center gap-2 text-sm">
                    <label className="flex w-16 items-center gap-2">
                      <input type="checkbox" checked={open} onChange={(e) => setDay(d, e.target.checked ? [{ start: "10:00", end: "20:00" }] : null)} />
                      {DAY_LABEL[d]}
                    </label>
                    <input type="time" disabled={!open} value={first.start} onChange={(e) => setDay(d, [{ ...first, start: e.target.value }])} className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-40" />
                    <span className="text-slate-400">to</span>
                    <input type="time" disabled={!open} value={first.end} onChange={(e) => setDay(d, [{ ...first, end: e.target.value }])} className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-40" />
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Services</legend>
            <p className="text-xs text-slate-500">Leave everything unticked to offer every service.</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={skills.includes(s.id)} onChange={(e) => setSkills((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))} />
                  {localized(s.name)}
                  {s.durationMinutes ? <span className="text-xs text-slate-400">{s.durationMinutes} min</span> : null}
                </label>
              ))}
              {services.length === 0 ? <p className="text-xs text-slate-400">No services in the catalog yet.</p> : null}
            </div>
          </fieldset>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}
