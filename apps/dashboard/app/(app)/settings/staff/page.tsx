"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, createUser, listUsers, me, resetUserPassword, type StaffUser, updateUser } from "@/lib/api";

export default function StaffPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);
  const [form, setForm] = useState({ email: "", name: "", role: "staff" as "staff" | "owner" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, session] = await Promise.all([listUsers(), me()]);
      setUsers(list.users);
      setMyId(session.user.id);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof Error ? err.message : "Could not load staff");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await createUser(form);
      setReveal({ email: res.user.email, password: res.temporaryPassword });
      setForm({ email: "", name: "", role: "staff" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  async function patch(u: StaffUser, change: Partial<Pick<StaffUser, "role" | "isActive">>) {
    try {
      const updated = await updateUser(u.id, change);
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function reset(u: StaffUser) {
    if (!window.confirm(`Reset the password for ${u.email}? Their current password stops working.`)) return;
    try {
      const res = await resetUserPassword(u.id);
      setReveal({ email: u.email, password: res.temporaryPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold">Staff</h1>
        <p className="mt-2 text-sm text-slate-600">Only owners can manage staff accounts.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">Staff</h1>
      <p className="mt-2 text-sm text-slate-600">Everyone here can sign in to this dashboard. Owners can also manage staff and templates.</p>

      {reveal ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Temporary password for {reveal.email}</p>
          <p className="mt-1 font-mono text-base">{reveal.password}</p>
          <p className="mt-1 text-xs text-amber-800">Share it privately. It is shown once; they can change it under Settings › Your password.</p>
          <button type="button" onClick={() => setReveal(null)} className="mt-2 text-xs underline">
            Dismiss
          </button>
        </div>
      ) : null}

      <form onSubmit={add} className="mt-6 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_8rem_auto]">
        <input type="email" required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
        <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "staff" | "owner" })} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </select>
        <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Active</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const self = u.id === myId;
              return (
                <tr key={u.id} className={u.isActive ? "" : "text-slate-400"}>
                  <td className="px-4 py-3 font-medium">
                    {u.name}
                    {self ? <span className="ml-2 text-xs text-slate-400">(you)</span> : null}
                  </td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <select value={u.role} disabled={self} onChange={(e) => void patch(u, { role: e.target.value as "staff" | "owner" })} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">
                      <option value="staff">Staff</option>
                      <option value="owner">Owner</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={u.isActive} disabled={self} onChange={(e) => void patch(u, { isActive: e.target.checked })} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => void reset(u)} className="text-xs text-slate-500 underline hover:text-slate-800">
                      Reset password
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
