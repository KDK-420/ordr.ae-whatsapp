"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, createProperty, getCatalog, listProperties, type LocalizedText, type Offering, type Property, updateProperty } from "@/lib/api";
import { localized, money } from "@/lib/format";
import { ImageField } from "./catalog";

const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";
const LANGS = [
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
];

/**
 * The properties a tenant runs from one WhatsApp number: a single resort or a whole group. Each
 * has its own address, check-in and check-out times, amenities and photos; room types are catalog
 * items of kind "Room type" that point at a property.
 */
export function Properties() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Offering[]>([]);
  const [editing, setEditing] = useState<Property | "new" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([listProperties(), getCatalog()]);
      setProperties(p.properties);
      setRooms(c.offerings.filter((o) => o.type === "stay"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the resorts");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle(p: Property) {
    try {
      const updated = await updateProperty(p.id, { isActive: !p.isActive });
      setProperties((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "Only owners can change resorts." : err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Resorts</h1>
          <p className="text-sm text-slate-600">Every property guests can book through your number. Add room types to each one under Catalog.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {error ? <span className="text-red-600">{error}</span> : null}
          <button type="button" onClick={() => setEditing("new")} className="rounded-md bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-dark">
            + Resort
          </button>
        </div>
      </div>

      {loaded && properties.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No resorts yet. Add your first property, then its room types in the catalog.</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {properties
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((p) => {
            const mine = rooms.filter((r) => r.propertyId === p.id);
            const units = mine.reduce((n, r) => n + (r.units ?? 1), 0);
            const from = mine.filter((r) => r.isActive).reduce<number | null>((min, r) => (min === null || r.priceMinor < min ? r.priceMinor : min), null);
            return (
              <article key={p.id} className={`overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${p.isActive ? "" : "opacity-60"}`}>
                {p.imageUrls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrls[0]} alt="" className="h-40 w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-40 items-center justify-center bg-slate-100 text-sm text-slate-400">No photo yet</div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{localized(p.name)}</h2>
                      {p.address ? <p className="truncate text-xs text-slate-500">{p.address}</p> : null}
                    </div>
                    <button type="button" onClick={() => setEditing(p)} className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:border-slate-400">
                      Edit
                    </button>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">{localized(p.description)}</p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <div>
                      <dt className="text-slate-400">Check-in / out</dt>
                      <dd>
                        {p.checkInTime} / {p.checkOutTime}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Room types</dt>
                      <dd>
                        {mine.length} · {units} units
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">From</dt>
                      <dd>{from !== null ? `${money(from, mine[0]?.currency ?? "AED")}/night` : "–"}</dd>
                    </div>
                  </dl>
                  {p.amenities.length ? <p className="mt-3 text-xs text-slate-500">{p.amenities.join(" · ")}</p> : null}
                  <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={p.isActive} onChange={() => void toggle(p)} /> Bookable by customers
                  </label>
                </div>
              </article>
            );
          })}
      </div>

      {editing ? (
        <PropertyDrawer
          item={editing === "new" ? null : editing}
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

function TextFields({ value, onChange, placeholder }: { value: LocalizedText; onChange: (v: LocalizedText) => void; placeholder: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {LANGS.map((l) => (
        <input key={l.code} value={value[l.code] ?? ""} onChange={(e) => onChange({ ...value, [l.code]: e.target.value })} placeholder={`${placeholder} (${l.label})`} dir={l.code === "ar" ? "rtl" : "ltr"} className={inputCls} />
      ))}
    </div>
  );
}

function PropertyDrawer({ item, onClose, onSaved }: { item: Property | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState<LocalizedText>(item?.name ?? {});
  const [description, setDescription] = useState<LocalizedText>(item?.description ?? {});
  const [address, setAddress] = useState(item?.address ?? "");
  const [mapsUrl, setMapsUrl] = useState(item?.mapsUrl ?? "");
  const [phone, setPhone] = useState(item?.phone ?? "");
  const [checkInTime, setCheckInTime] = useState(item?.checkInTime ?? "15:00");
  const [checkOutTime, setCheckOutTime] = useState(item?.checkOutTime ?? "12:00");
  const [amenities, setAmenities] = useState((item?.amenities ?? []).join(", "));
  const [images, setImages] = useState<string[]>(item?.imageUrls.length ? item.imageUrls : [""]);
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name,
        description: Object.values(description).some(Boolean) ? description : null,
        address: address.trim() || null,
        mapsUrl: mapsUrl.trim(),
        phone: phone.trim() || null,
        checkInTime,
        checkOutTime,
        amenities: amenities.split(",").map((a) => a.trim()).filter(Boolean),
        imageUrls: images.map((u) => u.trim()).filter(Boolean),
        sortOrder: Number(sortOrder) || 0,
        isActive,
      };
      if (item) await updateProperty(item.id, payload);
      else await createProperty(payload);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "Only owners can change resorts." : err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{item ? "Edit resort" : "New resort"}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            ✕
          </button>
        </div>
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
              <TextFields value={description} onChange={setDescription} placeholder="One or two sentences guests should hear" />
            </div>
          </label>
          <label className="block text-sm font-medium">
            Address
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Crescent Road West, Palm Jumeirah, Dubai" className={`${inputCls} mt-1`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Map link
              <input value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="https://maps.app.goo.gl/…" inputMode="url" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-sm font-medium">
              Front desk phone
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 4 000 0000" inputMode="tel" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-sm font-medium">
              Check-in from
              <input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-sm font-medium">
              Check-out by
              <input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Amenities
            <input value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="Private beach, Pool, Spa, Free parking" className={`${inputCls} mt-1`} />
            <span className="mt-1 block text-xs font-normal text-slate-500">Comma separated. The assistant mentions these when guests ask what the resort has.</span>
          </label>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Photos</legend>
            {images.map((url, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <ImageField label={i === 0 ? "Main photo" : `Photo ${i + 1}`} value={url} onChange={(v) => setImages((prev) => prev.map((x, j) => (j === i ? v : x)))} />
                </div>
                {images.length > 1 ? (
                  <button type="button" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))} className="mt-6 px-2 text-xs text-slate-400 hover:text-red-600">
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            {images.length < 6 ? (
              <button type="button" onClick={() => setImages((prev) => [...prev, ""])} className="text-xs font-medium text-brand hover:underline">
                + Add photo
              </button>
            ) : null}
            <p className="text-xs text-slate-500">The first two are sent when a guest asks to see the resort; room photos live on each room type in the catalog.</p>
          </fieldset>
          <div className="flex items-end gap-4">
            <label className="block text-sm font-medium">
              Sort order
              <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={`${inputCls} mt-1 w-28`} />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Bookable by customers
            </label>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : item ? "Save changes" : "Create resort"}
          </button>
        </form>
      </div>
    </div>
  );
}
