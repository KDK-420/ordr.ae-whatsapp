"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { logout } from "@/lib/api";
import { getSuite, type Branch, type SuiteModule, type SuiteView, type Theme, themeStyle } from "@/lib/suite";
import { Icon, type IconName } from "./icons";

interface SuiteContextValue {
  suite: SuiteView;
  /** Where the staff apps are mounted: /admin on the restaurant's host, /r on ours. */
  base: string;
  branch: Branch;
  setBranchId: (id: string) => void;
  reload: () => Promise<void>;
  /** False while the browser has no connection or the live stream is down. */
  online: boolean;
  has: (module: SuiteModule) => boolean;
  money: (minor: number) => string;
}

const SuiteContext = createContext<SuiteContextValue | null>(null);

export function useSuite(): SuiteContextValue {
  const ctx = useContext(SuiteContext);
  if (!ctx) throw new Error("useSuite must be used inside <SuiteProvider>");
  return ctx;
}

const BRANCH_KEY = "ordr.suite.branch";
type Listener = () => void;
const liveListeners = new Set<Listener>();

/**
 * Calls `onChange` whenever something about the restaurant's orders or kitchen changed, and on
 * every reconnect. The signal carries no data: screens refetch what they show.
 */
export function useLive(onChange: () => void): void {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    const listener = () => ref.current();
    liveListeners.add(listener);
    return () => {
      liveListeners.delete(listener);
    };
  }, []);
}

/** Loads the restaurant, paints its theme and keeps one live connection open for every screen below. */
export function SuiteProvider({ base, hostSlug, children }: { base: string; hostSlug: string | null; children: ReactNode }) {
  const [suite, setSuite] = useState<SuiteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branchId, setBranch] = useState<string | null>(null);
  const [streamUp, setStreamUp] = useState(true);
  const [netUp, setNetUp] = useState(true);

  const reload = useCallback(async () => {
    try {
      const view = await getSuite();
      setSuite(view);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the restaurant");
    }
  }, []);

  useEffect(() => {
    void reload();
    try {
      setBranch(window.localStorage.getItem(BRANCH_KEY));
    } catch {
      // private mode: the first branch is used
    }
    const up = () => setNetUp(true);
    const down = () => setNetUp(false);
    setNetUp(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [reload]);

  const staffModules = suite?.modules.some((m) => m !== "whatsapp") ?? false;
  useEffect(() => {
    if (!staffModules) return;
    const notify = () => liveListeners.forEach((l) => l());
    const source = new EventSource("/merchant/suite/stream");
    source.addEventListener("hello", () => {
      setStreamUp(true);
      notify();
    });
    source.addEventListener("change", notify);
    source.onerror = () => setStreamUp(false);
    // A safety net for a stream a proxy silently dropped.
    const poll = setInterval(notify, 30_000);
    return () => {
      source.close();
      clearInterval(poll);
    };
  }, [staffModules]);

  const value = useMemo<SuiteContextValue | null>(() => {
    if (!suite) return null;
    const active = suite.branches.filter((b) => b.isActive);
    const branch = active.find((b) => b.id === branchId) ?? active[0] ?? suite.branches[0]!;
    return {
      suite,
      base,
      branch,
      setBranchId: (id) => {
        setBranch(id);
        try {
          window.localStorage.setItem(BRANCH_KEY, id);
        } catch {
          // not remembered
        }
      },
      reload,
      online: netUp && streamUp,
      has: (m) => suite.modules.includes(m),
      money: (minor) => `${suite.currency} ${(minor / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    };
  }, [suite, base, branchId, reload, netUp, streamUp]);

  if (error && !suite) {
    return (
      <Centered>
        <p className="text-sm text-red-700">{error}</p>
        <button onClick={() => void reload()} className="mt-4 rounded-lg bg-sp px-4 py-2 text-sm font-semibold text-white">
          Try again
        </button>
      </Centered>
    );
  }
  if (!value || !suite) return <Centered>Loading…</Centered>;

  // A session is tied to one restaurant. Signed in to another one on this host: say so instead of showing the wrong shop.
  if (hostSlug && suite.tenant.slug !== hostSlug) {
    return (
      <Centered>
        <p className="text-base font-semibold">You are signed in to {suite.tenant.name}.</p>
        <p className="mt-2 text-sm opacity-70">This address belongs to another restaurant. Sign out to use a different account here.</p>
        <button
          onClick={() => void logout().finally(() => window.location.assign(`${base}/login`))}
          className="mt-4 rounded-lg bg-sp px-4 py-2 text-sm font-semibold text-white"
        >
          Sign out
        </button>
      </Centered>
    );
  }

  return (
    <SuiteContext.Provider value={value}>
      <div style={themeStyle(suite.theme)} className="min-h-dvh bg-sb text-st">
        {children}
      </div>
    </SuiteContext.Provider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center bg-sb px-6 text-center text-sm text-st">{children}</div>;
}

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Hidden unless the restaurant has this module. */
  module?: SuiteModule;
  /** Active only on this exact path, not on pages below it. */
  exact?: boolean;
}

export const POS_NAV: NavItem[] = [
  { href: "/pos", label: "Sale", icon: "sale", exact: true },
  { href: "/pos/orders", label: "Orders", icon: "orders" },
  { href: "/pos/customers", label: "Customers", icon: "customers" },
  { href: "/pos/products", label: "Products", icon: "products" },
  { href: "/inventory", label: "Inventory", icon: "inventory", module: "inventory" },
  { href: "/pos/reports", label: "Reports", icon: "reports" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export const INVENTORY_NAV: NavItem[] = [
  { href: "/inventory", label: "Dashboard", icon: "dashboard", exact: true },
  { href: "/inventory/items", label: "Inventory", icon: "inventory" },
  { href: "/inventory/purchases", label: "Purchases", icon: "purchases" },
  { href: "/inventory/suppliers", label: "Suppliers", icon: "suppliers" },
  { href: "/inventory/adjustments", label: "Stock Adjustments", icon: "adjustments" },
  { href: "/inventory/recipes", label: "Recipes", icon: "recipes" },
  { href: "/inventory/reports", label: "Reports", icon: "reports" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export const HOME_NAV: NavItem[] = [
  { href: "", label: "Apps", icon: "apps", exact: true },
  { href: "/pos", label: "Point of sale", icon: "sale", module: "pos" },
  { href: "/kds", label: "Kitchen", icon: "kitchen", module: "kds" },
  { href: "/inventory", label: "Inventory", icon: "inventory", module: "inventory" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function Logo({ theme, name, size = 36 }: { theme: Pick<Theme, "logoUrl">; name: string; size?: number }) {
  if (theme.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={theme.logoUrl} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-sp font-display font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Staff app chrome: the restaurant's dark sidebar, a top bar with the branch and the connection, and the page. */
export function AppFrame({ nav, module, title, actions, children, fill = false }: { nav: NavItem[]; module?: SuiteModule; title?: string; actions?: ReactNode; children: ReactNode; fill?: boolean }) {
  const { suite, base, branch, setBranchId, online, has } = useSuite();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const here = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\/(admin|r)/, "");
  const items = nav.filter((n) => !n.module || has(n.module));
  const isActive = (n: NavItem) => (n.exact ? here === n.href || here === `${n.href}/` : here === n.href || here.startsWith(`${n.href}/`));
  const branches = suite.branches.filter((b) => b.isActive);

  const allowed = !module || has(module);
  return (
    <div className={`flex ${fill ? "h-dvh overflow-hidden" : "min-h-dvh"}`}>
      <aside className="hidden w-56 shrink-0 flex-col bg-si text-white/80 md:flex">
        <Link href={base || "/"} className="flex items-center gap-3 px-5 py-5">
          <Logo theme={suite.theme} name={suite.tenant.name} />
          <span className="font-display text-[15px] font-semibold leading-tight text-white">{suite.tenant.name}</span>
        </Link>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((n) => (
            <Link
              key={n.href}
              href={`${base}${n.href}`}
              aria-current={isActive(n) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive(n) ? "bg-sp text-white shadow-sm" : "hover:bg-white/10 hover:text-white"}`}
            >
              <Icon name={n.icon} size={19} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3 text-sm">
          <Link href={base || "/"} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/10 hover:text-white">
            <Icon name="apps" size={18} /> All apps
          </Link>
          <button onClick={() => void logout().finally(() => window.location.assign(base === "/admin" ? "/admin/login" : "/login"))} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/10 hover:text-white">
            <Icon name="logout" size={18} /> Sign out
          </button>
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col ${fill ? "h-dvh" : ""}`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-si/10 bg-white px-4 py-2.5 md:px-6">
          <button className="rounded-lg p-1.5 text-si hover:bg-si/5 md:hidden" onClick={() => setMenu(true)} aria-label="Menu">
            <Icon name="menu" />
          </button>
          {title ? <h1 className="truncate text-base font-semibold text-si md:text-lg">{title}</h1> : null}
          <label className="relative ml-1 flex items-center">
            <span className="sr-only">Branch</span>
            <select
              value={branch.id}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={branches.length < 2}
              className="appearance-none rounded-lg border border-si/15 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-si outline-none focus:border-sp disabled:opacity-100"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <Icon name="down" size={14} className="pointer-events-none absolute right-2.5 text-si/60" />
          </label>
          <div className="ml-auto flex items-center gap-3">
            {actions}
            <span className={`hidden items-center gap-1.5 text-xs font-medium sm:flex ${online ? "text-emerald-700" : "text-amber-700"}`} role="status">
              <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`} />
              {online ? "Online" : "Reconnecting"}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-si/10 text-xs font-semibold text-si" title={`${suite.user.name} · ${suite.user.email}`}>
              {initials(suite.user.name || suite.user.email)}
            </span>
          </div>
        </header>
        <main className={fill ? "min-h-0 flex-1" : "flex-1 px-4 py-5 md:px-6 md:py-6"}>
          {allowed ? (
            children
          ) : (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-si/10 bg-white p-8 text-center">
              <p className="text-base font-semibold text-si">This app is not switched on for {suite.tenant.name}.</p>
              <p className="mt-2 text-sm text-si/70">Ask ordr.ae to add it to your plan.</p>
              <Link href={base || "/"} className="mt-5 inline-block rounded-lg bg-sp px-4 py-2 text-sm font-semibold text-white">
                Back to apps
              </Link>
            </div>
          )}
        </main>
      </div>

      {menu ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setMenu(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-si p-3 text-white/85">
            <div className="flex items-center gap-3 px-2 py-3">
              <Logo theme={suite.theme} name={suite.tenant.name} />
              <span className="font-display font-semibold text-white">{suite.tenant.name}</span>
            </div>
            <nav className="mt-2 flex-1 space-y-1">
              {items.map((n) => (
                <Link key={n.href} href={`${base}${n.href}`} onClick={() => setMenu(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive(n) ? "bg-sp text-white" : ""}`}>
                  <Icon name={n.icon} size={19} />
                  {n.label}
                </Link>
              ))}
            </nav>
            <Link href={base || "/"} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm">
              <Icon name="apps" size={18} /> All apps
            </Link>
            <button onClick={() => void logout().finally(() => window.location.assign(base === "/admin" ? "/admin/login" : "/login"))} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm">
              <Icon name="logout" size={18} /> Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** A white card on the cream background. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-si/10 bg-white ${className}`}>{children}</div>;
}

export function StatCard({ label, value, hint, tone = "plain", icon }: { label: string; value: ReactNode; hint?: string; tone?: "plain" | "warn" | "bad" | "good"; icon?: IconName }) {
  const tones = { plain: "bg-si/5 text-si", warn: "bg-amber-100 text-amber-700", bad: "bg-red-100 text-red-700", good: "bg-emerald-100 text-emerald-700" } as const;
  return (
    <Card className="flex items-center gap-4 p-4">
      {icon ? (
        <span className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl min-[420px]:flex ${tones[tone]}`}>
          <Icon name={icon} />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-si/60">{label}</p>
        <p className="mt-0.5 text-lg font-semibold leading-tight text-si sm:text-xl">{value}</p>
        {hint ? <p className="truncate text-xs text-si/50">{hint}</p> : null}
      </div>
    </Card>
  );
}

/** A dialog on desktop, a bottom sheet on a phone. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/45" aria-label="Close" onClick={onClose} />
      <div className={`suite-scroll relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 text-si shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-si/5" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputClass = "mt-1 w-full rounded-lg border border-si/20 bg-white px-3 py-2 text-sm text-si outline-none focus:border-sp";
export const primaryButton = "rounded-lg bg-sp px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50";
export const ghostButton = "rounded-lg border border-si/20 bg-white px-4 py-2 text-sm font-semibold text-si transition hover:bg-si/5 disabled:opacity-50";
