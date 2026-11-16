"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/suite/icons";
import { newClientRef, type Quote, type StoreItem, storeOrder, storeQuote, storeTrack, type TrackedOrder } from "@/lib/suite";
import { useStore } from "./cart";
import { ItemCard, ItemSheet, Thumb } from "./chrome";

/** The front page: a promise, the favourites, the categories, and who the restaurant is. */
export function StoreHome() {
  const { store, base } = useStore();
  const [open, setOpen] = useState<StoreItem | null>(null);
  const hero = store.heroImageUrl ?? store.theme.coverImageUrl;
  const shots = store.featured.filter((i) => i.imageUrl).slice(0, 3);
  const [first, ...restWords] = (store.headline ?? `${store.name}, Delivered.`).split(", ");
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 pt-8 md:grid-cols-2 md:px-6 md:pb-16 md:pt-14">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sp">{store.fulfillmentTypes.map((t) => (t === "pickup" ? "Pickup" : "Delivery")).join(" or ")}</p>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.08] text-si sm:text-5xl lg:text-6xl">
            {first}
            {restWords.length ? (
              <>
                ,<br />
                <span className="text-sp">{restWords.join(", ")}</span>
              </>
            ) : null}
          </h1>
          {store.about || store.theme.tagline ? <p className="mt-4 max-w-md text-base text-si/70">{store.about ?? store.theme.tagline}</p> : null}
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={`${base}/menu`} className="rounded-full bg-sp px-7 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95">
              Order Now
            </Link>
            <Link href={`${base}/menu`} className="rounded-full border border-si/25 px-7 py-3.5 text-sm font-semibold text-si transition hover:bg-si/5">
              Our Menu
            </Link>
          </div>
        </div>
        <div className="relative">
          {hero ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero} alt="" className="aspect-[5/4] w-full rounded-[2rem] object-cover shadow-lg" />
          ) : shots.length ? (
            <div className="relative mx-auto aspect-[5/4] max-w-lg">
              <Thumb src={shots[0]!.imageUrl} name={shots[0]!.name} className="absolute inset-y-0 left-0 h-full w-[68%] rounded-[2rem] shadow-lg" />
              {shots[1] ? <Thumb src={shots[1].imageUrl} name={shots[1].name} className="absolute right-0 top-[6%] h-[44%] w-[38%] rounded-3xl border-4 border-sb shadow-md" /> : null}
              {shots[2] ? <Thumb src={shots[2].imageUrl} name={shots[2].name} className="absolute bottom-[4%] right-[4%] h-[42%] w-[36%] rounded-3xl border-4 border-sb shadow-md" /> : null}
            </div>
          ) : (
            <div className="aspect-[5/4] rounded-[2rem] bg-sa/30" />
          )}
        </div>
      </section>

      {store.categories.length > 1 ? (
        <section className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2 md:justify-center md:gap-8">
            {store.categories.map((c) => (
              <Link key={c.id} href={`${base}/menu#${c.id}`} className="flex w-20 shrink-0 flex-col items-center gap-2 text-center">
                <Thumb src={c.items.find((i) => i.imageUrl)?.imageUrl} name={c.name} className="h-16 w-16 rounded-full border-2 border-white shadow-sm" />
                <span className="text-xs font-semibold text-si">{c.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {store.featured.length ? (
        <section className="mx-auto mt-12 max-w-6xl px-4 md:px-6">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl font-semibold text-si md:text-3xl">Featured Favourites</h2>
            <Link href={`${base}/menu`} className="flex items-center gap-1 text-sm font-semibold text-sp">
              Full menu <Icon name="right" size={16} />
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
            {store.featured.slice(0, 4).map((item) => (
              <ItemCard key={item.id} item={item} onChoose={setOpen} />
            ))}
          </div>
        </section>
      ) : null}

      <section id="about" className="mx-auto mt-16 max-w-6xl scroll-mt-20 px-4 md:px-6">
        <div className="grid gap-6 rounded-[2rem] bg-white p-7 md:grid-cols-3 md:p-10">
          <div className="md:col-span-2">
            <h2 className="font-display text-2xl font-semibold text-si md:text-3xl">About {store.name}</h2>
            <p className="mt-3 max-w-2xl text-si/70">{store.about ?? store.theme.tagline ?? "Made fresh, every order."}</p>
          </div>
          <ul className="space-y-3 text-sm text-si/75">
            <li className="flex gap-2.5">
              <Icon name="bag" size={18} className="shrink-0 text-sp" /> Order ahead and skip the queue
            </li>
            {store.fulfillmentTypes.includes("delivery") ? (
              <li className="flex gap-2.5">
                <Icon name="purchases" size={18} className="shrink-0 text-sp" /> Delivered to your door
              </li>
            ) : null}
            <li className="flex gap-2.5">
              <Icon name="clock" size={18} className="shrink-0 text-sp" /> Follow your order live
            </li>
          </ul>
        </div>
      </section>
      {open ? <ItemSheet item={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/** The whole menu, by category, with search. */
export function StoreMenu() {
  const { store } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<StoreItem | null>(null);
  const [active, setActive] = useState(store.categories[0]?.id ?? "");
  const needle = q.trim().toLowerCase();
  const categories = useMemo(
    () => store.categories.map((c) => ({ ...c, items: c.items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.description?.toLowerCase().includes(needle)) })).filter((c) => c.items.length),
    [store.categories, needle],
  );

  // The chip of the section on screen is the highlighted one.
  useEffect(() => {
    const sections = store.categories.map((c) => document.getElementById(c.id)).filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-140px 0px -55% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [store.categories, needle]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 md:px-6">
      <div className="pt-8">
        <h1 className="font-display text-3xl font-semibold text-si md:text-4xl">Menu</h1>
        <label className="relative mt-4 block max-w-md">
          <Icon name="search" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-si/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu" className="w-full rounded-full border border-si/15 bg-white py-3 pl-11 pr-4 text-sm text-si outline-none focus:border-sp" />
        </label>
      </div>
      <div className="no-scrollbar sticky top-[61px] z-20 -mx-4 mt-4 flex gap-2 overflow-x-auto bg-sb/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        {categories.map((c) => (
          <a key={c.id} href={`#${c.id}`} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${active === c.id ? "bg-sp text-white" : "border border-si/15 bg-white text-si"}`}>
            {c.name}
          </a>
        ))}
      </div>
      {categories.map((c) => (
        <section key={c.id} id={c.id} className="scroll-mt-36 pt-6">
          <h2 className="font-display text-2xl font-semibold text-si">{c.name}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
            {c.items.map((item) => (
              <ItemCard key={item.id} item={item} onChoose={setOpen} />
            ))}
          </div>
        </section>
      ))}
      {!categories.length ? <p className="py-20 text-center text-sm text-si/55">{needle ? "Nothing on the menu matches that." : "The menu is being prepared. Check back soon."}</p> : null}
      {open ? <ItemSheet item={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

const CONTACT_KEY = "ordr.store.contact";

/** Who it is for, pickup or delivery, and the bill as the restaurant's system prices it. */
export function StoreCheckout() {
  const { store, base, lines, count, clear, price, ready, setQuantity } = useStore();
  const [type, setType] = useState<"pickup" | "delivery">(store.fulfillmentTypes.includes("pickup") ? "pickup" : "delivery");
  const [branchId, setBranchId] = useState(store.branches[0]?.id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef(newClientRef());
  const orderLines = useMemo(() => lines.map((l) => ({ offeringId: l.itemId, quantity: l.quantity, optionIds: l.optionIds, notes: l.notes })), [lines]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CONTACT_KEY) ?? "{}") as { name?: string; phone?: string; address?: string };
      setName(saved.name ?? "");
      setPhone(saved.phone ?? "");
      setAddress(saved.address ?? "");
    } catch {
      // nothing remembered
    }
  }, []);

  useEffect(() => {
    if (!orderLines.length) return setQuote(null);
    let stale = false;
    storeQuote(store.slug, { lines: orderLines, fulfillmentType: type })
      .then((q) => !stale && (setQuote(q), setError(null)))
      .catch((err) => !stale && setError(err instanceof Error ? err.message : "Could not price your order"));
    return () => {
      stale = true;
    };
  }, [store.slug, orderLines, type]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await storeOrder(store.slug, { clientRef: clientRef.current, branchId: branchId || undefined, fulfillmentType: type, lines: orderLines, name: name.trim(), phone: phone.trim(), address: type === "delivery" ? address.trim() : undefined, notes: notes.trim() || undefined });
      try {
        window.localStorage.setItem(CONTACT_KEY, JSON.stringify({ name: name.trim(), phone: phone.trim(), address: address.trim() }));
      } catch {
        // not remembered
      }
      clear();
      window.location.assign(`${base}/o/${res.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your order did not go through. Please try again.");
      setBusy(false);
    }
  };

  if (ready && !count) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-semibold text-si">Your cart is empty</h1>
        <Link href={`${base}/menu`} className="mt-6 inline-block rounded-full bg-sp px-7 py-3.5 text-sm font-semibold text-white">
          See the menu
        </Link>
      </div>
    );
  }

  const field = "mt-1 w-full rounded-xl border border-si/20 bg-white px-3.5 py-3 text-sm text-si outline-none focus:border-sp";
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:grid-cols-[1fr_22rem] md:px-6">
      <div className="space-y-5">
        <h1 className="font-display text-3xl font-semibold text-si">Checkout</h1>
        {store.fulfillmentTypes.length > 1 ? (
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-si/5 p-1">
            {(["pickup", "delivery"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} aria-pressed={type === t} className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition ${type === t ? "bg-white text-si shadow-sm" : "text-si/60"}`}>
                <Icon name={t === "pickup" ? "bag" : "purchases"} size={18} /> {t === "pickup" ? "Pickup" : "Delivery"}
              </button>
            ))}
          </div>
        ) : null}
        {type === "pickup" && store.branches.length > 1 ? (
          <label className="block text-sm font-medium text-si">
            Pick up from
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field}>
              {store.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {type === "pickup" && store.branches.length === 1 ? (
          <p className="flex gap-2 rounded-2xl bg-white p-4 text-sm text-si/75">
            <Icon name="pin" size={18} className="shrink-0 text-sp" />
            <span>
              Pick up from <span className="font-semibold text-si">{store.branches[0]!.name}</span>
              {store.branches[0]!.address || store.profile.address ? <span className="block">{store.branches[0]!.address ?? store.profile.address}</span> : null}
            </span>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-si">
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" className={field} />
          </label>
          <label className="block text-sm font-medium text-si">
            Mobile number
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required minLength={8} maxLength={30} inputMode="tel" autoComplete="tel" placeholder="050 123 4567" className={field} />
          </label>
        </div>
        {type === "delivery" ? (
          <label className="block text-sm font-medium text-si">
            Delivery address
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} required maxLength={300} rows={2} autoComplete="street-address" placeholder="Building, flat, street, area" className={field} />
          </label>
        ) : null}
        <label className="block text-sm font-medium text-si">
          Notes for the shop
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className={field} />
        </label>
        <div className="rounded-2xl bg-white p-4 text-sm text-si/75">
          <p className="font-semibold text-si">Payment</p>
          <p className="mt-1 flex items-center gap-2">
            <Icon name="cash" size={18} className="text-sp" /> {type === "pickup" ? "Pay at the counter when you collect, cash or card." : "Pay the driver on delivery."}
          </p>
        </div>
      </div>

      <aside className="h-fit rounded-3xl bg-white p-5 md:sticky md:top-24">
        <h2 className="font-display text-xl font-semibold text-si">Your order</h2>
        <ul className="mt-3 divide-y divide-si/10">
          {lines.map((l) => (
            <li key={l.key} className="flex gap-3 py-3 text-sm">
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => setQuantity(l.key, l.quantity - 1)} className="flex h-6 w-6 items-center justify-center rounded-full border border-si/20 text-si" aria-label={`One less ${l.name}`}>
                  <Icon name="minus" size={12} />
                </button>
                <span className="w-4 text-center font-semibold tabular-nums text-si">{l.quantity}</span>
                <button type="button" onClick={() => setQuantity(l.key, l.quantity + 1)} className="flex h-6 w-6 items-center justify-center rounded-full border border-si/20 text-si" aria-label={`One more ${l.name}`}>
                  <Icon name="plus" size={12} />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-si">{l.name}</p>
                {l.optionNames.length ? <p className="truncate text-xs text-si/55">{l.optionNames.join(", ")}</p> : null}
              </div>
              <span className="tabular-nums text-si">{price(l.unitMinor * l.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1.5 border-t border-si/10 pt-3 text-sm text-si/70">
          <Row k="Subtotal" v={quote ? price(quote.subtotalMinor) : "…"} />
          {quote?.deliveryFeeMinor ? <Row k="Delivery" v={price(quote.deliveryFeeMinor)} /> : null}
          <Row k={`VAT (${Math.round(store.vatRate * 100)}%)${store.vatInclusive ? " included" : ""}`} v={quote ? price(quote.vatMinor) : "…"} />
          <div className="flex justify-between pt-1.5 text-lg font-bold text-si">
            <dt>Total</dt>
            <dd className="tabular-nums">{quote ? price(quote.totalMinor) : "…"}</dd>
          </div>
        </dl>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        <button type="submit" disabled={busy || !quote} className="mt-4 w-full rounded-xl bg-sp py-3.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
          {busy ? "Placing your order…" : "Place order"}
        </button>
      </aside>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

const cap = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** What the customer reads at the top of the tracking page, per order state. */
function trackHeadline(order: TrackedOrder): string {
  if (order.step < 0) return "This order was cancelled";
  const delivery = order.fulfillmentType === "delivery";
  const lines: Record<string, string> = {
    placed: "We have your order",
    accepted: "Your order is confirmed",
    preparing: "Your order is being prepared",
    ready: delivery ? "Your order is ready and waiting for the driver" : "Your order is ready for pickup",
    out_for_delivery: "Your order is on its way",
    delivered: "Delivered. Enjoy!",
    completed: "All done. Enjoy!",
  };
  return lines[order.status] ?? cap(order.statusLabel);
}

/** The customer's view of one order: where it is, what is in it, where to collect it. Refreshes by itself. */
export function StoreTrack({ token, initial }: { token: string; initial: TrackedOrder }) {
  const { store, base } = useStore();
  const [order, setOrder] = useState(initial);
  const closed = order.step < 0 || order.step >= order.steps.length - 1;
  useEffect(() => {
    if (closed) return;
    const t = setInterval(() => {
      storeTrack(store.slug, token)
        .then(setOrder)
        .catch(() => undefined);
    }, 8000);
    return () => clearInterval(t);
  }, [store.slug, token, closed]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sp">Order #{order.number}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-si md:text-4xl">{trackHeadline(order)}</h1>
      <p className="mt-2 text-sm text-si/65">
        {order.fulfillmentType === "delivery" ? "Delivery" : "Pickup"}
        {order.branch ? ` · ${order.branch.name}` : ""} · placed {new Date(order.placedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
      </p>

      {order.step >= 0 ? (
        <ol className="mt-8 flex" aria-label="Order progress">
          {order.steps.map((label, i) => {
            const done = i <= order.step;
            return (
              <li key={label} className="relative flex flex-1 flex-col items-center text-center">
                {i > 0 ? <span className={`absolute right-1/2 top-4 h-0.5 w-full ${done ? "bg-sp" : "bg-si/15"}`} aria-hidden="true" /> : null}
                <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-sp text-white" : "bg-white text-si/40 ring-1 ring-si/15"} ${i === order.step && !closed ? "ring-4 ring-sp/25" : ""}`}>{done ? <Icon name="check" size={16} /> : i + 1}</span>
                <span className={`mt-2 px-1 text-xs font-semibold ${done ? "text-si" : "text-si/45"}`}>{cap(label)}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="mt-8 rounded-3xl bg-white p-5">
        <ul className="divide-y divide-si/10">
          {order.items.map((l, i) => (
            <li key={i} className="flex gap-3 py-3 text-sm">
              <span className="w-7 font-semibold tabular-nums text-si">{l.quantity}×</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-si">{l.title}</span>
                {l.modifiers.length ? <span className="block text-xs text-si/55">{l.modifiers.join(", ")}</span> : null}
              </span>
              <span className="tabular-nums text-si">{l.lineTotal}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1.5 border-t border-si/10 pt-3 text-sm text-si/70">
          <Row k="Subtotal" v={order.subtotal} />
          {order.discount ? <Row k="Discount" v={`– ${order.discount}`} /> : null}
          {order.deliveryFee ? <Row k="Delivery" v={order.deliveryFee} /> : null}
          <Row k={order.vatInclusive ? "VAT included" : "VAT"} v={order.vat} />
          <div className="flex justify-between pt-1.5 text-lg font-bold text-si">
            <dt>Total</dt>
            <dd className="tabular-nums">{order.total}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-si/65">{order.paymentStatus === "paid" ? "Paid" : order.fulfillmentType === "delivery" ? "Pay the driver on delivery" : "Pay at the counter when you collect"}</p>
      </div>

      {order.branch?.address || order.branch?.phone ? (
        <div className="mt-4 rounded-3xl bg-white p-5 text-sm text-si/75">
          {order.branch.address ? (
            <p className="flex gap-2">
              <Icon name="pin" size={18} className="shrink-0 text-sp" /> {order.branch.address}
            </p>
          ) : null}
          {order.branch.phone ? (
            <p className="mt-2 flex gap-2">
              <Icon name="phone" size={18} className="shrink-0 text-sp" />
              <a href={`tel:${order.branch.phone.replace(/[^\d+]/g, "")}`}>{order.branch.phone}</a>
            </p>
          ) : null}
        </div>
      ) : null}
      <Link href={`${base}/menu`} className="mt-6 inline-block text-sm font-semibold text-sp">
        Order something else
      </Link>
    </div>
  );
}
