"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { type Category, getCatalog, logout } from "@/lib/api";
import { type Branch, createBranch, MODULE_LABELS, type Station, type SuiteModule, SWATCHES, updateBranch } from "@/lib/suite";
import { Icon, type IconName } from "./icons";
import { AppFrame, Card, ghostButton, HOME_NAV, inputClass, Logo, Modal, primaryButton, useSuite } from "./shell";

const APPS: Array<{ module: SuiteModule; icon: IconName; blurb: string }> = [
  { module: "pos", icon: "sale", blurb: "Ring up sales at the counter, hold orders, take cash and card." },
  { module: "kds", icon: "kitchen", blurb: "Live tickets for the bar and the kitchen, from every channel." },
  { module: "inventory", icon: "inventory", blurb: "Stock, cups and packaging, purchases, recipes and waste." },
  { module: "storefront", icon: "store", blurb: "Your ordering website for pickup and delivery." },
  { module: "whatsapp", icon: "chat", blurb: "Orders and customer chat on WhatsApp." },
];

/** The address of our own app for the WhatsApp inbox: app.ordr.ae from daybreak.ordr.ae, localhost from daybreak.localhost. */
function appOrigin(): string {
  const { protocol, hostname, port } = window.location;
  const parts = hostname.split(".");
  const root = parts.slice(1).join(".");
  return `${protocol}//${root === "localhost" ? "localhost" : `app.${root}`}${port ? `:${port}` : ""}`;
}

/** The front door for staff: one tile per app the restaurant has. */
export function Launcher() {
  const { suite, base, has } = useSuite();
  const [links, setLinks] = useState<Record<SuiteModule, string>>({ pos: `${base}/pos`, kds: `${base}/kds`, inventory: `${base}/inventory`, storefront: "/", whatsapp: "/inbox" });
  useEffect(() => {
    const onHost = base === "/admin";
    setLinks((l) => ({ ...l, storefront: onHost ? "/" : `/site/${suite.tenant.slug}`, whatsapp: onHost ? `${appOrigin()}/inbox` : "/inbox" }));
  }, [base, suite.tenant.slug]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
      <header className="flex items-center gap-4">
        <Logo theme={suite.theme} name={suite.tenant.name} size={52} />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold text-si md:text-3xl">{suite.tenant.name}</h1>
          <p className="text-sm text-si/60">Signed in as {suite.user.name || suite.user.email}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`${base}/settings`} className="rounded-lg p-2 text-si/70 hover:bg-si/5" aria-label="Settings">
            <Icon name="settings" />
          </Link>
          <button onClick={() => void logout().finally(() => window.location.assign(base === "/admin" ? "/admin/login" : "/login"))} className="rounded-lg p-2 text-si/70 hover:bg-si/5" aria-label="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {APPS.map((app) => {
          const on = has(app.module);
          const body = (
            <>
              <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${on ? "bg-sp text-white" : "bg-si/10 text-si/40"}`}>
                <Icon name={app.icon} size={24} />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-si">{MODULE_LABELS[app.module]}</h2>
              <p className="mt-1 text-sm text-si/60">{app.blurb}</p>
              <p className={`mt-4 text-sm font-semibold ${on ? "text-sp" : "text-si/40"}`}>{on ? "Open" : "Not on your plan"}</p>
            </>
          );
          return on ? (
            <Link key={app.module} href={links[app.module]} className="rounded-2xl border border-si/10 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-md">
              {body}
            </Link>
          ) : (
            <div key={app.module} className="rounded-2xl border border-dashed border-si/15 p-5">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Branches, kitchen stations and how the restaurant looks. Modules and theme are set by ordr.ae. */
export function SuiteSettings() {
  const { suite, reload } = useSuite();
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    getCatalog()
      .then((c) => setCategories(c.categories.filter((x) => x.isActive)))
      .catch(() => undefined);
  }, []);
  const owner = suite.user.role === "owner";
  const swatch = SWATCHES.find((s) => s.id === suite.theme.swatch);
  return (
    <AppFrame nav={HOME_NAV} title="Settings">
      <div className="grid max-w-4xl gap-4">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Your apps</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(MODULE_LABELS) as SuiteModule[]).map((m) => (
              <li key={m} className={`rounded-full px-3 py-1.5 text-sm font-medium ${suite.modules.includes(m) ? "bg-sp/10 text-sp" : "bg-si/5 text-si/40 line-through"}`}>
                {MODULE_LABELS[m]}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-si/55">Apps are switched on by ordr.ae. Get in touch to add one.</p>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">Look</h2>
          <div className="mt-3 flex items-center gap-3">
            {[suite.theme.primary, suite.theme.accent, suite.theme.ink, suite.theme.background].map((c, i) => (
              <span key={i} className="h-9 w-9 rounded-full border border-si/15" style={{ background: c }} title={c} />
            ))}
            <span className="text-sm font-medium">{swatch?.name ?? "Custom colours"}</span>
          </div>
          <p className="mt-3 text-xs text-si/55">The same colours paint your ordering site and these apps.</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Branches and kitchen stations</h2>
            {owner ? (
              <button onClick={() => setEditing("new")} className="text-sm font-semibold text-sp">
                + Add branch
              </button>
            ) : null}
          </div>
          <ul className="mt-2 divide-y divide-si/10">
            {suite.branches.map((b) => (
              <li key={b.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {b.name} {!b.isActive ? <span className="text-xs font-normal text-si/45">(closed)</span> : null}
                  </p>
                  {b.address ? <p className="text-sm text-si/60">{b.address}</p> : null}
                  <p className="mt-1 text-xs text-si/55">Stations: {b.stations.map((s) => s.name).join(", ")}</p>
                </div>
                {owner ? (
                  <button onClick={() => setEditing(b)} className={ghostButton}>
                    Edit
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {editing ? <BranchDialog branch={editing === "new" ? null : editing} categories={categories} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </AppFrame>
  );
}

function BranchDialog({ branch, categories, onClose, onSaved }: { branch: Branch | null; categories: Category[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(branch?.name ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [stations, setStations] = useState<Station[]>(branch?.stations ?? [{ id: "st_kitchen", name: "Kitchen", categoryIds: [] }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStation = (i: number, patch: Partial<Station>) => setStations((ss) => ss.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const clean = stations.filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim() }));
      if (branch) await updateBranch(branch.id, { name: name.trim(), address: address.trim() || null, phone: phone.trim() || null, stations: clean });
      else await createBranch({ name: name.trim(), address: address.trim() || undefined, phone: phone.trim() || undefined, stations: clean });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <Modal title={branch ? "Edit branch" : "Add branch"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={inputClass} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Address
          <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} className={inputClass} />
        </label>
        <div>
          <p className="text-sm font-medium">Kitchen stations</p>
          <p className="text-xs text-si/55">Each station sees the items of its categories on the kitchen display. Items of a category no station lists go to the first one.</p>
          <div className="mt-2 space-y-2">
            {stations.map((s, i) => (
              <div key={s.id} className="rounded-xl border border-si/10 p-3">
                <div className="flex gap-2">
                  <input value={s.name} onChange={(e) => setStation(i, { name: e.target.value })} placeholder="Bar" maxLength={40} className="min-w-0 flex-1 rounded-lg border border-si/20 px-3 py-1.5 text-sm outline-none focus:border-sp" aria-label="Station name" />
                  {stations.length > 1 ? (
                    <button type="button" onClick={() => setStations((ss) => ss.filter((_, n) => n !== i))} className="rounded-lg p-1.5 text-si/45 hover:text-red-700" aria-label="Remove station">
                      <Icon name="close" size={16} />
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {categories.map((c) => {
                    const on = s.categoryIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setStation(i, { categoryIds: on ? s.categoryIds.filter((x) => x !== c.id) : [...s.categoryIds, c.id] })}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-sp text-white" : "bg-si/5 text-si/70"}`}
                      >
                        {c.name.en ?? Object.values(c.name)[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setStations((ss) => [...ss, { id: `st_${Date.now().toString(36)}`, name: "", categoryIds: [] }])} className="mt-2 text-sm font-semibold text-sp">
            + Add station
          </button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-2">
          {branch ? (
            <button type="button" onClick={() => void updateBranch(branch.id, { isActive: !branch.isActive }).then(onSaved).then(onClose).catch((err) => setError(err instanceof Error ? err.message : "Could not save"))} className={ghostButton}>
              {branch.isActive ? "Close branch" : "Reopen branch"}
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
