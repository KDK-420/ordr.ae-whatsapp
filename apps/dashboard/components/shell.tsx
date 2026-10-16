"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { logout, me, type Me } from "@/lib/api";

/** App chrome: tenant name, signed-in user, sign out. */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Me | null>(null);

  useEffect(() => {
    me()
      .then(setSession)
      .catch(() => undefined);
  }, []);

  async function onLogout() {
    await logout().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-baseline gap-4">
            <Link href="/orders" className="text-lg font-semibold tracking-tight">
              ordr<span className="text-brand">.ae</span>
            </Link>
            {session?.tenant ? <span className="text-sm text-slate-600">{session.tenant.name}</span> : null}
          </div>
          <div className="flex items-center gap-4 text-sm">
            {session ? <span className="hidden text-slate-500 sm:inline">{session.user.email}</span> : null}
            <button type="button" onClick={onLogout} className="rounded-md border border-slate-300 px-3 py-1.5 hover:border-slate-400">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
