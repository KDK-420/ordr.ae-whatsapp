"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { logout, me, type Me } from "@/lib/api";

/** `module` hides the entry unless the tenant's blueprint lists that dashboard module; `admin` shows it to platform admins only. */
const NAV: Array<{ href: string; label: string; module?: string; admin?: boolean }> = [
  { href: "/orders", label: "Orders" },
  { href: "/calendar", label: "Calendar", module: "calendar" },
  { href: "/inbox", label: "Inbox" },
  { href: "/catalog", label: "Catalog" },
  { href: "/settings", label: "Settings" },
  { href: "/demo", label: "Demo" },
  { href: "/admin", label: "Admin", admin: true },
];

/** App chrome: navigation, tenant name, signed-in user, sign out. */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/orders" className="text-lg font-semibold tracking-tight">
              ordr<span className="text-brand">.ae</span>
            </Link>
            <nav className="flex gap-1 text-sm">
              {NAV.filter((item) => (!item.module || session?.tenant?.modules.includes(item.module)) && (!item.admin || session?.user.platformAdmin)).map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-3 py-1.5 ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {session?.tenant ? <span className="hidden text-slate-600 md:inline">{session.tenant.name}</span> : null}
            {session ? <span className="hidden text-slate-400 lg:inline">{session.user.email}</span> : null}
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
