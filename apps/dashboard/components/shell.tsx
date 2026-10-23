"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { listConversations, logout, me, type Me } from "@/lib/api";

/** How often the nav re-counts threads waiting for a person. */
const HUMAN_COUNT_POLL_MS = 15000;

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
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    me()
      .then(setSession)
      .catch(() => undefined);
  }, []);

  // Threads the bot handed to a person: the badge next to Inbox so staff see them from any page.
  useEffect(() => {
    if (!session?.tenant) return;
    const count = () =>
      listConversations("human")
        .then((r) => setWaiting(r.conversations.length))
        .catch(() => undefined);
    void count();
    const t = setInterval(count, HUMAN_COUNT_POLL_MS);
    return () => clearInterval(t);
  }, [session?.tenant, pathname]);

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
                    {item.href === "/inbox" && waiting > 0 ? (
                      <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-amber-400 text-slate-900" : "bg-amber-100 text-amber-800"}`} title={`${waiting} waiting for a person`}>
                        {waiting}
                      </span>
                    ) : null}
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
