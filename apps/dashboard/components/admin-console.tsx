"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  addPooledNumber,
  type AdminOverview,
  ApiError,
  assignPooledNumber,
  createTenant,
  type CreateTenantResult,
  getAdminOverview,
  releasePooledNumber,
  resetTenantOwnerPassword,
} from "@/lib/api";

const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

export function AdminConsole() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ title: string; email: string; password: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await getAdminOverview());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof Error ? err.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (forbidden) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-slate-600">This page is for platform operators only.</p>
      </div>
    );
  }

  const tenantName = (id: string | null) => data?.tenants.find((t) => t.tenant.id === id)?.tenant.name ?? "";

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admin</h1>
          <p className="mt-1 text-sm text-slate-600">Merchants on this platform and the WhatsApp numbers they use. Numbers come from ordr.ae's own WhatsApp account; onboarding a merchant is: add a number once, create the tenant, hand over the login.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          New merchant
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {reveal ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">{reveal.title}</p>
          <p className="mt-1">
            Login <span className="font-mono">{reveal.email}</span> · temporary password <span className="font-mono text-base">{reveal.password}</span>
          </p>
          <p className="mt-1 text-xs text-amber-800">Shown once. Send it privately; they can change it under Settings › Your password.</p>
          <button type="button" onClick={() => setReveal(null)} className="mt-2 text-xs underline">
            Dismiss
          </button>
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 font-semibold">Merchants</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Vertical</th>
                <th className="px-4 py-2">WhatsApp number</th>
                <th className="px-4 py-2">Owners</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.tenants.map((t) => (
                <tr key={t.tenant.id}>
                  <td className="px-4 py-3 font-medium">
                    {t.tenant.name}
                    <div className="text-xs font-normal text-slate-400">{t.tenant.slug}</div>
                  </td>
                  <td className="px-4 py-3 capitalize">{t.tenant.blueprintId}</td>
                  <td className="px-4 py-3">{t.channel ? t.channel.displayPhone : <span className="text-slate-400">none</span>}</td>
                  <td className="px-4 py-3 text-xs">
                    {t.owners.length === 0 ? <span className="text-slate-400">no owner</span> : null}
                    {t.owners.map((o) => (
                      <div key={o.id} className="flex items-center gap-2">
                        <span>{o.email}</span>
                        <button
                          type="button"
                          className="text-slate-500 underline hover:text-slate-800"
                          onClick={async () => {
                            if (!window.confirm(`Reset the password for ${o.email}?`)) return;
                            try {
                              const r = await resetTenantOwnerPassword(t.tenant.id, o.id);
                              setReveal({ title: `New password for ${t.tenant.name}`, email: r.email, password: r.temporaryPassword });
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Reset failed");
                            }
                          }}
                        >
                          reset password
                        </button>
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">{t.tenant.timezone}</td>
                </tr>
              ))}
              {data && data.tenants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No merchants yet
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Number pool</h2>
        <p className="mb-3 text-sm text-slate-600">
          Add each number after verifying it in Meta's WhatsApp Manager (SMS or call to the SIM). The values are on the number's API setup page; the token is a system user token with messaging and management permissions.
        </p>
        <AddNumberForm
          onAdded={async () => {
            await refresh();
          }}
          onError={setError}
        />
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Number</th>
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2">Phone number ID</th>
                <th className="px-4 py-2">Used by</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.numbers.map((n) => (
                <tr key={n.id}>
                  <td className="px-4 py-3 font-medium">{n.displayPhone}</td>
                  <td className="px-4 py-3 text-slate-500">{n.label ?? ""}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{n.phoneNumberId}</td>
                  <td className="px-4 py-3">{n.tenantId ? tenantName(n.tenantId) || n.tenantId : <span className="text-slate-400">free</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <AssignControls
                      numberId={n.id}
                      assigned={n.tenantId}
                      tenants={data.tenants.map((t) => ({ id: t.tenant.id, name: t.tenant.name }))}
                      onChange={async () => {
                        await refresh();
                      }}
                      onError={setError}
                    />
                  </td>
                </tr>
              ))}
              {data && data.numbers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No numbers yet
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {creating && data ? (
        <NewTenantDrawer
          overview={data}
          onClose={() => setCreating(false)}
          onCreated={async (r: CreateTenantResult) => {
            setCreating(false);
            setReveal({ title: `${r.tenant.name} is ready${r.channel ? ` on ${r.channel.displayPhone}` : ""}`, email: r.owner.email, password: r.owner.temporaryPassword });
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function AddNumberForm({ onAdded, onError }: { onAdded: () => Promise<void>; onError: (e: string | null) => void }) {
  const [form, setForm] = useState({ displayPhone: "", phoneNumberId: "", wabaId: "", accessToken: "", label: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await addPooledNumber({ ...form, label: form.label || undefined });
      setForm({ displayPhone: "", phoneNumberId: "", wabaId: "", accessToken: "", label: "" });
      await onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the number");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_1fr_1.5fr_1fr_auto]">
      <input required placeholder="+971 50 …" value={form.displayPhone} onChange={(e) => setForm({ ...form, displayPhone: e.target.value })} className={inputCls} />
      <input required placeholder="Phone number ID" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} className={inputCls} />
      <input required placeholder="WABA ID" value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value })} className={inputCls} />
      <input required type="password" placeholder="System user access token" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} className={inputCls} />
      <input placeholder="Label (SIM 3, du)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} />
      <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
        {busy ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

function AssignControls({ numberId, assigned, tenants, onChange, onError }: { numberId: string; assigned: string | null; tenants: Array<{ id: string; name: string }>; onChange: () => Promise<void>; onError: (e: string | null) => void }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    onError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs">
        <option value="">{assigned ? "Move to…" : "Assign to…"}</option>
        {tenants
          .filter((t) => t.id !== assigned)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
      </select>
      <button type="button" disabled={busy || !target} onClick={() => run(() => assignPooledNumber(numberId, target)).then(() => setTarget(""))} className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:border-slate-400 disabled:opacity-50">
        Go
      </button>
      {assigned ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Release this number? Its merchant stops receiving WhatsApp messages until a number is assigned again.")) void run(() => releasePooledNumber(numberId));
          }}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-red-400 hover:text-red-700 disabled:opacity-50"
        >
          Release
        </button>
      ) : null}
    </div>
  );
}

function NewTenantDrawer({ overview, onClose, onCreated }: { overview: AdminOverview; onClose: () => void; onCreated: (r: CreateTenantResult) => Promise<void> }) {
  const free = overview.numbers.filter((n) => !n.tenantId);
  const [form, setForm] = useState({ name: "", blueprintId: overview.verticals[0]?.id ?? "restaurant", ownerEmail: "", ownerName: "", defaultLanguage: "en" as "en" | "ar", numberId: free[0]?.id ?? "", seedDemo: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreated(await createTenant({ ...form, numberId: form.numberId || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the merchant");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()} role="presentation">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} onKeyDown={() => undefined} role="presentation">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New merchant</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">
            Business name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${inputCls} mt-1`} placeholder="Glow Salon" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Vertical
              <select value={form.blueprintId} onChange={(e) => setForm({ ...form, blueprintId: e.target.value })} className={`${inputCls} mt-1`}>
                {overview.verticals.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Default language
              <select value={form.defaultLanguage} onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value as "en" | "ar" })} className={`${inputCls} mt-1`}>
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Owner name
              <input required value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-sm font-medium">
              Owner email
              <input required type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} className={`${inputCls} mt-1`} />
            </label>
          </div>
          <label className="block text-sm font-medium">
            WhatsApp number
            <select value={form.numberId} onChange={(e) => setForm({ ...form, numberId: e.target.value })} className={`${inputCls} mt-1`}>
              <option value="">Assign later</option>
              {free.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.displayPhone}
                  {n.label ? ` (${n.label})` : ""}
                </option>
              ))}
            </select>
            {free.length === 0 ? <span className="mt-1 block text-xs text-slate-500">No free numbers in the pool; add one below the merchants list first.</span> : null}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.seedDemo} onChange={(e) => setForm({ ...form, seedDemo: e.target.checked })} /> Load the demo catalog for this vertical (they can edit it afterwards)
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Creating…" : "Create merchant"}
          </button>
        </form>
      </div>
    </div>
  );
}
