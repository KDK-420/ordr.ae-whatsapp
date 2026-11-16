"use client";

import { useEffect, useState } from "react";
import { getTenantSuite, MODULE_LABELS, setTenantSuite, type SuiteModule, SWATCHES } from "@/lib/suite";

export const ALL_MODULES = Object.keys(MODULE_LABELS) as SuiteModule[];

const MODULE_HINT: Record<SuiteModule, string> = {
  storefront: "Ordering website at the restaurant's address",
  pos: "Till for the counter, at /admin/pos",
  kds: "Kitchen screens, at /admin/kds",
  inventory: "Stock, cups and packaging, purchases, recipes",
  whatsapp: "WhatsApp ordering and the inbox",
};

/** The five modules a restaurant can have; the restaurant sees menus only for the ones ticked. */
export function ModulePicker({ value, onChange }: { value: SuiteModule[]; onChange: (next: SuiteModule[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ALL_MODULES.map((m) => {
        const on = value.includes(m);
        return (
          <label key={m} className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm ${on ? "border-brand bg-green-50" : "border-slate-200"}`}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== m) : ALL_MODULES.filter((x) => x === m || value.includes(x)))} className="mt-0.5" />
            <span>
              <span className="font-medium">{MODULE_LABELS[m]}</span>
              <span className="block text-xs text-slate-500">{MODULE_HINT[m]}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** The five built-in looks. Each paints the ordering site and the staff apps. */
export function SwatchPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {SWATCHES.map((s) => (
        <button key={s.id} type="button" onClick={() => onChange(s.id)} aria-pressed={value === s.id} className={`rounded-lg border p-2 text-left text-xs font-medium ${value === s.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"}`}>
          <span className="flex h-9 overflow-hidden rounded-md">
            <span className="flex-[2]" style={{ background: s.ink }} />
            <span className="flex-[2]" style={{ background: s.primary }} />
            <span className="flex-1" style={{ background: s.accent }} />
            <span className="flex-[2] border-y border-r border-slate-200" style={{ background: s.background }} />
          </span>
          <span className="mt-1.5 block">{s.name}</span>
        </button>
      ))}
    </div>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_FIELDS = [
  ["primary", "Buttons"],
  ["accent", "Highlights"],
  ["ink", "Sidebar and footer"],
  ["background", "Background"],
] as const;

/** Change a restaurant's modules and look after it was created. */
export function TenantSuiteDrawer({ tenant, onClose }: { tenant: { id: string; name: string; slug: string }; onClose: () => void }) {
  const [modules, setModules] = useState<SuiteModule[] | null>(null);
  const [swatch, setSwatch] = useState("espresso");
  const [colors, setColors] = useState<Record<string, string>>({});
  const [tagline, setTagline] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTenantSuite(tenant.id)
      .then((s) => {
        setModules(s.modules);
        setSwatch(s.theme.swatch);
        setColors({ primary: s.theme.primary, accent: s.theme.accent, ink: s.theme.ink, background: s.theme.background });
        setTagline(s.theme.tagline ?? "");
        setLogoUrl(s.theme.logoUrl ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load"));
  }, [tenant.id]);

  const pickSwatch = (id: string) => {
    setSwatch(id);
    const s = SWATCHES.find((x) => x.id === id);
    if (s) setColors({ primary: s.primary, accent: s.accent, ink: s.ink, background: s.background });
  };
  const custom = swatch === "custom";
  const validColors = !custom || COLOR_FIELDS.every(([k]) => HEX.test(colors[k] ?? ""));

  async function save() {
    if (!modules) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setTenantSuite(tenant.id, { modules, theme: { swatch, ...(custom ? colors : {}), tagline, logoUrl } });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const host = `${tenant.slug}.ordr.ae`;
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()} role="presentation">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} onKeyDown={() => undefined} role="presentation">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{tenant.name}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Customers: <span className="font-mono">{host}</span> · Staff: <span className="font-mono">{host}/admin</span>
        </p>

        <h3 className="mt-6 text-sm font-semibold">Modules</h3>
        <p className="mb-2 text-xs text-slate-500">The restaurant sees menus only for what is ticked. Changes apply on their next page load.</p>
        {modules ? <ModulePicker value={modules} onChange={setModules} /> : <p className="text-sm text-slate-400">Loading…</p>}

        <h3 className="mt-6 text-sm font-semibold">Theme</h3>
        <p className="mb-2 text-xs text-slate-500">One look for the ordering site and the staff apps.</p>
        <SwatchPicker value={swatch} onChange={pickSwatch} />
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={custom} onChange={(e) => (e.target.checked ? setSwatch("custom") : pickSwatch("espresso"))} /> Custom colours
        </label>
        {custom ? (
          <div className="mt-2 grid grid-cols-2 gap-3">
            {COLOR_FIELDS.map(([key, label]) => (
              <label key={key} className="block text-xs font-medium text-slate-600">
                {label}
                <span className="mt-1 flex items-center gap-2">
                  <input type="color" value={HEX.test(colors[key] ?? "") ? colors[key] : "#000000"} onChange={(e) => setColors({ ...colors, [key]: e.target.value })} className="h-9 w-10 rounded border border-slate-300" aria-label={`${label} colour`} />
                  <input value={colors[key] ?? ""} onChange={(e) => setColors({ ...colors, [key]: e.target.value })} className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm" />
                </span>
              </label>
            ))}
          </div>
        ) : null}
        <label className="mt-4 block text-sm font-medium">
          Tagline
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={200} placeholder="Freshly roasted, made your way." className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
        </label>
        <label className="mt-3 block text-sm font-medium">
          Logo link
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} maxLength={500} placeholder="https://…/logo.png" inputMode="url" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
        </label>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {saved ? <p className="mt-4 text-sm text-green-700">Saved.</p> : null}
        <button type="button" onClick={() => void save()} disabled={busy || !modules || !validColors} className="mt-5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
