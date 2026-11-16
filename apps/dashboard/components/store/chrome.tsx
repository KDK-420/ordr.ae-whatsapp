"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { Icon } from "@/components/suite/icons";
import { Logo } from "@/components/suite/shell";
import { type PublicStore, type StoreItem, themeStyle } from "@/lib/suite";
import { StoreProvider, useStore } from "./cart";

/** Every page of the ordering site: the restaurant's colours, header, cart and footer around the content. */
export function StoreFrame({ store, base, children, plain = false }: { store: PublicStore; base: string; children: ReactNode; plain?: boolean }) {
  return (
    <StoreProvider store={store} base={base}>
      <div style={themeStyle(store.theme)} className="flex min-h-dvh flex-col bg-sb text-st">
        <Header />
        <div className="flex-1">{children}</div>
        {plain ? null : <Footer />}
        <CartDrawer />
        <CartBar />
      </div>
    </StoreProvider>
  );
}

function Header() {
  const { store, base, count, setCartOpen } = useStore();
  const [menu, setMenu] = useState(false);
  const home = base || "/";
  const links = [
    { href: home, label: "Home" },
    { href: `${base}/menu`, label: "Menu" },
    { href: `${base}/menu`, label: "Order Online" },
    { href: `${home}#about`, label: "About" },
    { href: `${home}#contact`, label: "Contact" },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-si/10 bg-sb/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-6">
        <button className="rounded-lg p-1.5 text-si hover:bg-si/5 md:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
          <Icon name={menu ? "close" : "menu"} />
        </button>
        <Link href={home} className="flex items-center gap-2.5">
          <Logo theme={store.theme} name={store.name} size={38} />
          <span className="font-display text-lg font-semibold leading-tight text-si">{store.name}</span>
        </Link>
        <nav className="ml-8 hidden gap-7 text-sm font-medium text-si/75 md:flex">
          {links.map((l) => (
            <Link key={l.label} href={l.href} className="hover:text-sp">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link href={`${base}/menu`} className="rounded-full p-2 text-si hover:bg-si/5" aria-label="Search the menu">
            <Icon name="search" />
          </Link>
          <button onClick={() => setCartOpen(true)} className="relative rounded-full p-2 text-si hover:bg-si/5" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
            <Icon name="bag" />
            {count > 0 ? <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-sp px-1 text-[11px] font-bold text-white">{count}</span> : null}
          </button>
        </div>
      </div>
      {menu ? (
        <nav className="border-t border-si/10 px-4 py-2 md:hidden">
          {links.map((l) => (
            <Link key={l.label} href={l.href} onClick={() => setMenu(false)} className="block rounded-lg px-2 py-2.5 text-sm font-medium text-si">
              {l.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function Footer() {
  const { store, base } = useStore();
  const p = store.profile;
  return (
    <footer id="contact" className="mt-16 bg-si text-white/75">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3 md:px-6">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo theme={store.theme} name={store.name} size={38} />
            <span className="font-display text-lg font-semibold text-white">{store.name}</span>
          </div>
          {store.theme.tagline ? <p className="mt-3 max-w-xs text-sm">{store.theme.tagline}</p> : null}
        </div>
        <div className="space-y-2.5 text-sm">
          <h2 className="font-semibold text-white">Visit us</h2>
          {store.branches.map((b) => (
            <p key={b.id} className="flex gap-2">
              <Icon name="pin" size={16} className="mt-0.5 shrink-0 text-sa" />
              <span>
                {store.branches.length > 1 ? <span className="block font-medium text-white">{b.name}</span> : null}
                {b.address ?? p.address ?? b.name}
              </span>
            </p>
          ))}
          {p.hours ? (
            <p className="flex gap-2">
              <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-sa" /> {p.hours}
            </p>
          ) : null}
          {p.phone ? (
            <p className="flex gap-2">
              <Icon name="phone" size={16} className="mt-0.5 shrink-0 text-sa" />
              <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="hover:text-white">
                {p.phone}
              </a>
            </p>
          ) : null}
          {p.mapsUrl ? (
            <a href={p.mapsUrl} target="_blank" rel="noreferrer" className="inline-block font-medium text-sa hover:underline">
              Open in Maps
            </a>
          ) : null}
        </div>
        <div className="text-sm">
          <h2 className="font-semibold text-white">Order</h2>
          <Link href={`${base}/menu`} className="mt-2.5 block hover:text-white">
            Menu
          </Link>
          <p className="mt-2">{store.fulfillmentTypes.map((t) => (t === "pickup" ? "Pickup" : "Delivery")).join(" · ")}</p>
        </div>
      </div>
      <p className="border-t border-white/10 py-4 text-center text-xs text-white/45">
        © {new Date().getFullYear()} {store.name} · Ordering by ordr.ae
      </p>
    </footer>
  );
}

/** Phones: the cart rides along the bottom edge once it has something in it. */
function CartBar() {
  const { count, subtotalMinor, price, setCartOpen, cartOpen } = useStore();
  if (!count || cartOpen) return null;
  return (
    <button onClick={() => setCartOpen(true)} className="fixed inset-x-4 bottom-4 z-30 flex items-center justify-between rounded-2xl bg-sp px-5 py-3.5 text-white shadow-lg md:hidden">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Icon name="bag" size={18} /> View cart ({count})
      </span>
      <span className="text-sm font-bold tabular-nums">{price(subtotalMinor)}</span>
    </button>
  );
}

function CartDrawer() {
  const { base, lines, count, subtotalMinor, price, setQuantity, cartOpen, setCartOpen } = useStore();
  useEffect(() => {
    if (!cartOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCartOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cartOpen, setCartOpen]);
  if (!cartOpen) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your order">
      <button className="absolute inset-0 bg-black/45" aria-label="Close cart" onClick={() => setCartOpen(false)} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white text-si shadow-xl">
        <div className="flex items-center justify-between border-b border-si/10 px-5 py-4">
          <h2 className="font-display text-xl font-semibold">Your order ({count})</h2>
          <button onClick={() => setCartOpen(false)} className="rounded-lg p-1.5 hover:bg-si/5" aria-label="Close cart">
            <Icon name="close" />
          </button>
        </div>
        <ul className="suite-scroll min-h-0 flex-1 divide-y divide-si/10 overflow-y-auto px-5">
          {lines.map((l) => (
            <li key={l.key} className="flex gap-3 py-4">
              <Thumb src={l.imageUrl} name={l.name} className="h-16 w-16 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{l.name}</p>
                {l.optionNames.length ? <p className="truncate text-xs text-si/55">{l.optionNames.join(", ")}</p> : null}
                {l.notes ? <p className="truncate text-xs text-sp">{l.notes}</p> : null}
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => setQuantity(l.key, l.quantity - 1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-si/20" aria-label={`One less ${l.name}`}>
                    <Icon name="minus" size={14} />
                  </button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                  <button onClick={() => setQuantity(l.key, l.quantity + 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-sp text-white" aria-label={`One more ${l.name}`}>
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              </div>
              <p className="text-sm font-semibold tabular-nums">{price(l.unitMinor * l.quantity)}</p>
            </li>
          ))}
          {!lines.length ? (
            <li className="py-16 text-center text-sm text-si/50">
              Your cart is empty.
              <Link href={`${base}/menu`} onClick={() => setCartOpen(false)} className="mt-3 block font-semibold text-sp">
                See the menu
              </Link>
            </li>
          ) : null}
        </ul>
        {lines.length ? (
          <div className="border-t border-si/10 p-5">
            <div className="flex items-baseline justify-between text-base font-bold">
              <span>Subtotal</span>
              <span className="tabular-nums">{price(subtotalMinor)}</span>
            </div>
            <Link href={`${base}/checkout`} onClick={() => setCartOpen(false)} className="mt-4 block rounded-xl bg-sp py-3.5 text-center text-sm font-semibold text-white hover:brightness-95">
              Checkout
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Thumb({ src, name, className = "" }: { src?: string; name: string; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={`shrink-0 bg-sa/25 object-cover ${className}`} loading="lazy" />
  ) : (
    <span className={`flex shrink-0 items-center justify-center bg-sa/25 font-display text-2xl text-si/30 ${className}`}>{name.charAt(0)}</span>
  );
}

/** A menu card: photo, name, price and a round plus. Items with choices open their sheet first. */
export function ItemCard({ item, onChoose }: { item: StoreItem; onChoose: (item: StoreItem) => void }) {
  const { add, price } = useStore();
  const [added, setAdded] = useState(false);
  const hasChoices = item.modifierGroups.length > 0;
  const press = () => {
    if (hasChoices) return onChoose(item);
    add(item);
    setAdded(true);
    setTimeout(() => setAdded(false), 900);
  };
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-si/10 bg-white transition hover:shadow-md">
      <button onClick={() => onChoose(item)} className="block aspect-[4/3] w-full overflow-hidden text-left" aria-label={`${item.name}, details`}>
        <Thumb src={item.imageUrl} name={item.name} className="h-full w-full transition duration-300 group-hover:scale-[1.03]" />
      </button>
      <div className="flex flex-1 items-end justify-between gap-2 p-3.5">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-si">{item.name}</h3>
          {item.description ? <p className="mt-0.5 line-clamp-2 text-xs text-si/55">{item.description}</p> : null}
          <p className="mt-1.5 text-sm font-semibold text-si">{price(item.priceMinor)}</p>
        </div>
        <button onClick={press} className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition active:scale-95 ${added ? "bg-emerald-600" : "bg-sp hover:brightness-95"}`} aria-label={`Add ${item.name}`}>
          <Icon name={added ? "check" : "plus"} size={17} />
        </button>
      </div>
    </article>
  );
}

/** One item up close: its photo, its choices (size, milk, extras), a note, and how many. */
export function ItemSheet({ item, onClose }: { item: StoreItem; onClose: () => void }) {
  const { add, price } = useStore();
  const [chosen, setChosen] = useState<Record<string, string[]>>(() => Object.fromEntries(item.modifierGroups.map((g) => [g.id, g.minSelect >= 1 && g.options[0] ? [g.options[0].id] : []])));
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (groupId: string, min: number, max: number, optionId: string) =>
    setChosen((c) => {
      const cur = c[groupId] ?? [];
      if (max <= 1) return { ...c, [groupId]: cur.includes(optionId) ? (min === 0 ? [] : cur) : [optionId] };
      if (cur.includes(optionId)) return { ...c, [groupId]: cur.filter((x) => x !== optionId) };
      return cur.length >= max ? c : { ...c, [groupId]: [...cur, optionId] };
    });
  const ids = Object.values(chosen).flat();
  const valid = item.modifierGroups.every((g) => (chosen[g.id]?.length ?? 0) >= g.minSelect);
  const unit = item.priceMinor + item.modifierGroups.flatMap((g) => g.options).filter((o) => ids.includes(o.id)).reduce((n, o) => n + o.priceDeltaMinor, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={item.name}>
      <button className="absolute inset-0 bg-black/45" aria-label="Close" onClick={onClose} />
      <div className="suite-scroll relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white text-si shadow-xl sm:max-w-lg sm:rounded-3xl">
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-2 shadow" aria-label="Close">
          <Icon name="close" size={18} />
        </button>
        <Thumb src={item.imageUrl} name={item.name} className="aspect-[16/10] w-full" />
        <div className="p-5">
          <h2 className="font-display text-2xl font-semibold">{item.name}</h2>
          {item.description ? <p className="mt-1 text-sm text-si/65">{item.description}</p> : null}
          <div className="mt-4 space-y-4">
            {item.modifierGroups.map((g) => (
              <fieldset key={g.id}>
                <legend className="text-sm font-semibold">
                  {g.name} <span className="font-normal text-si/50">{g.minSelect >= 1 ? (g.maxSelect > 1 ? `choose ${g.minSelect} to ${g.maxSelect}` : "choose one") : g.maxSelect > 1 ? `up to ${g.maxSelect}` : "optional"}</span>
                </legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {g.options.map((o) => {
                    const on = chosen[g.id]?.includes(o.id) ?? false;
                    return (
                      <button key={o.id} type="button" aria-pressed={on} onClick={() => pick(g.id, g.minSelect, g.maxSelect, o.id)} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${on ? "border-sp bg-sp/10 font-semibold" : "border-si/15 text-si/80 hover:bg-si/5"}`}>
                        <span className="truncate">{o.name}</span>
                        {o.priceDeltaMinor ? <span className="shrink-0 text-xs text-si/60">+{(o.priceDeltaMinor / 100).toFixed(2)}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <label className="block text-sm font-semibold">
              Anything we should know?
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Extra hot, no sugar…" className="mt-1 w-full rounded-xl border border-si/20 px-3 py-2.5 text-sm font-normal outline-none focus:border-sp" />
            </label>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="flex h-10 w-10 items-center justify-center rounded-full border border-si/20" aria-label="One less">
                <Icon name="minus" size={16} />
              </button>
              <span className="w-6 text-center font-semibold tabular-nums">{quantity}</span>
              <button onClick={() => setQuantity((q) => Math.min(99, q + 1))} className="flex h-10 w-10 items-center justify-center rounded-full border border-si/20" aria-label="One more">
                <Icon name="plus" size={16} />
              </button>
            </div>
            <button
              disabled={!valid}
              onClick={() => {
                add(item, ids, quantity, notes.trim() || undefined);
                onClose();
              }}
              className="flex-1 rounded-xl bg-sp py-3.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
            >
              Add to order · {price(unit * quantity)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
