"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { money, type PublicStore, type StoreItem } from "@/lib/suite";

export interface CartLine {
  key: string;
  itemId: string;
  name: string;
  imageUrl?: string;
  quantity: number;
  optionIds: string[];
  optionNames: string[];
  unitMinor: number;
  notes?: string;
}

interface StoreContextValue {
  store: PublicStore;
  /** "" on the restaurant's own host, /site/<slug> on ours. */
  base: string;
  lines: CartLine[];
  count: number;
  subtotalMinor: number;
  add: (item: StoreItem, optionIds?: string[], quantity?: number, notes?: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  price: (minor: number) => string;
  /** False until the saved cart has been read, so pages do not flash "empty". */
  ready: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

const keyOf = (itemId: string, optionIds: string[], notes?: string) => `${itemId}|${[...optionIds].sort().join(",")}|${notes ?? ""}`;

/** Holds the restaurant and the customer's cart. The cart lives in this browser until the order is placed. */
export function StoreProvider({ store, base, children }: { store: PublicStore; base: string; children: ReactNode }) {
  const storageKey = `ordr.cart.${store.slug}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as CartLine[];
      // Drop anything that left the menu since the cart was saved.
      const known = new Set(store.categories.flatMap((c) => c.items.map((i) => i.id)));
      if (Array.isArray(saved)) setLines(saved.filter((l) => l && known.has(l.itemId) && l.quantity > 0));
    } catch {
      // an unreadable cart starts empty
    }
    setReady(true);
  }, [storageKey, store.categories]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(lines));
    } catch {
      // private mode: the cart lasts as long as the page
    }
  }, [lines, ready, storageKey]);

  const add = useCallback((item: StoreItem, optionIds: string[] = [], quantity = 1, notes?: string) => {
    const options = item.modifierGroups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id));
    const key = keyOf(item.id, optionIds, notes);
    setLines((ls) =>
      ls.some((l) => l.key === key)
        ? ls.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l))
        : [...ls, { key, itemId: item.id, name: item.name, imageUrl: item.imageUrl, quantity, optionIds, optionNames: options.map((o) => o.name), unitMinor: item.priceMinor + options.reduce((n, o) => n + o.priceDeltaMinor, 0), notes }],
    );
  }, []);
  const setQuantity = useCallback((key: string, quantity: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, quantity) } : l)).filter((l) => l.quantity > 0)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<StoreContextValue>(
    () => ({
      store,
      base,
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      subtotalMinor: lines.reduce((n, l) => n + l.unitMinor * l.quantity, 0),
      add,
      setQuantity,
      clear,
      cartOpen,
      setCartOpen,
      price: (minor) => money(minor, store.currency),
      ready,
    }),
    [store, base, lines, add, setQuantity, clear, cartOpen, ready],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
