"use client";

import { type CSSProperties, type FormEvent, useState } from "react";
import { ApiError, login } from "@/lib/api";

/** Staff sign-in on a restaurant's own host, in the restaurant's colours. */
export function StaffLogin({ name, style, next }: { name: string; style: CSSProperties; next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Wrong email or password." : "Could not sign in. Please try again.");
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-lg border border-si/20 bg-white px-3 py-2.5 text-sm text-si outline-none focus:border-sp";
  return (
    <main style={style} className="flex min-h-dvh items-center justify-center bg-si px-5 py-10">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl bg-sb p-7 text-si shadow-xl">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sp font-display text-xl font-semibold text-white" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold">{name}</h1>
        <p className="mt-1 text-sm text-si/60">Staff sign in</p>
        <label className="mt-6 block text-sm font-medium">
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </label>
        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
        <button type="submit" disabled={busy} className="mt-6 w-full rounded-lg bg-sp px-4 py-3 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="mt-5 text-center text-xs text-si/45">Powered by ordr.ae</p>
      </form>
    </main>
  );
}
