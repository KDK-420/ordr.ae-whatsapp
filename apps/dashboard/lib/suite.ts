/** Client for the restaurant suite: POS, kitchen display, inventory and the public ordering site. Same origin, session cookie. */

import type { CSSProperties } from "react";

export type SuiteModule = "storefront" | "pos" | "kds" | "inventory" | "whatsapp";
export const MODULE_LABELS: Record<SuiteModule, string> = { storefront: "Online store", pos: "Point of sale", kds: "Kitchen display", inventory: "Inventory", whatsapp: "WhatsApp" };

export interface Theme {
  swatch: string;
  primary: string;
  accent: string;
  ink: string;
  background: string;
  text: string;
  logoUrl?: string;
  coverImageUrl?: string;
  tagline?: string;
}

export const SWATCHES: Array<{ id: string; name: string; primary: string; accent: string; ink: string; background: string }> = [
  { id: "espresso", name: "Espresso", primary: "#B4531F", accent: "#E9B87A", ink: "#2B1D14", background: "#FAF6F1" },
  { id: "olive_grove", name: "Olive Grove", primary: "#3F5F3A", accent: "#D9A441", ink: "#1F2A1C", background: "#F7F7F0" },
  { id: "chili", name: "Chili", primary: "#B3261E", accent: "#F2A33A", ink: "#2A1512", background: "#FFF8F5" },
  { id: "ocean", name: "Ocean", primary: "#0E5E6F", accent: "#F08A5D", ink: "#0F2A30", background: "#F4FAFB" },
  { id: "midnight", name: "Midnight", primary: "#1F2937", accent: "#E0B354", ink: "#111827", background: "#F8F8F7" },
];

/** The restaurant's colours as CSS variables, for any element that wraps themed content. Safe on the server and in the browser. */
export function themeStyle(theme: Pick<Theme, "primary" | "accent" | "ink" | "background" | "text">): CSSProperties {
  // --color-brand follows too, so screens shared with the WhatsApp dashboard (the menu editor) take the restaurant's colour here.
  return { "--suite-primary": theme.primary, "--suite-accent": theme.accent, "--suite-ink": theme.ink, "--suite-bg": theme.background, "--suite-text": theme.text, "--color-brand": theme.primary, "--color-brand-dark": theme.primary } as CSSProperties;
}

export interface Station {
  id: string;
  name: string;
  categoryIds: string[];
}

export interface Branch {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  stations: Station[];
  sortOrder: number;
  isActive: boolean;
}

export interface SuiteView {
  tenant: { id: string; name: string; slug: string; timezone: string };
  modules: SuiteModule[];
  theme: Theme;
  branches: Branch[];
  currency: string;
  vatRate: number;
  vatInclusive: boolean;
  deliveryFeeMinor: number;
  user: { name: string; email: string; role: string };
}

export class SuiteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SuiteError";
  }
}

/** Where the staff apps are mounted in this browser tab: /admin on a restaurant's host, /r on ours. */
export function staffBaseHere(): string {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/admin") ? "/admin" : "/r";
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...(init.headers ?? {}) }, cache: "no-store" });
  if (res.status === 401 && typeof window !== "undefined" && path.startsWith("/merchant/")) {
    const base = staffBaseHere();
    window.location.assign(base === "/admin" ? "/admin/login" : "/login");
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    } catch {
      // keep the status text
    }
    throw new SuiteError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });
const qs = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
};

export function money(minor: number, currency = "AED"): string {
  return `${currency} ${(minor / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A short random id that makes a retried order request return the first order. */
export function newClientRef(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `c_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export const getSuite = () => call<SuiteView>("/merchant/suite");
export const createBranch = (input: { name: string; address?: string; phone?: string; stations?: Station[] }) => call<Branch>("/merchant/suite/branches", json(input));
export const updateBranch = (id: string, patch: Partial<{ name: string; address: string | null; phone: string | null; stations: Station[]; isActive: boolean }>) =>
  call<Branch>(`/merchant/suite/branches/${encodeURIComponent(id)}`, json(patch, "PATCH"));

export interface AdminSuite {
  modules: SuiteModule[];
  theme: Theme;
  available: SuiteModule[];
  /** Whether search engines may list the restaurant's ordering site. Off until the operator turns it on. */
  listInSearch: boolean;
}
export const getTenantSuite = (tenantId: string) => call<AdminSuite>(`/merchant/admin/tenants/${encodeURIComponent(tenantId)}/suite`);
export const setTenantSuite = (tenantId: string, patch: { modules?: SuiteModule[]; theme?: Partial<Theme>; listInSearch?: boolean }) =>
  call<unknown>(`/merchant/admin/tenants/${encodeURIComponent(tenantId)}/suite`, json(patch, "PATCH"));

// ---------------------------------------------------------------------------
// Orders (POS)
// ---------------------------------------------------------------------------

export interface LineInput {
  offeringId: string;
  quantity: number;
  optionIds?: string[];
  notes?: string;
}

export interface Discount {
  type: "percent" | "amount";
  value: number;
  reason?: string;
}

export interface PricedLine {
  offeringId: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  modifiers: Array<{ optionId?: string; title: string; priceDeltaMinor: number }>;
  notes?: string;
  kitchenStatus?: string;
}

export interface Quote {
  currency: string;
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  vatMinor: number;
  vatRate: number;
  vatInclusive: boolean;
  totalMinor: number;
}

export interface Payment {
  id: string;
  method: "cash" | "card" | "online";
  amountMinor: number;
  tenderedMinor?: number;
  changeMinor?: number;
  reference?: string;
  createdAt: string;
}

export interface PosOrder {
  id: string;
  number: number;
  status: string;
  source: string;
  fulfillmentType: string;
  tableLabel?: string;
  contactName?: string;
  contactPhone?: string;
  customerName?: string;
  items: PricedLine[];
  currency: string;
  subtotalMinor: number;
  discountMinor?: number;
  deliveryFeeMinor: number;
  vatMinor: number;
  totalMinor: number;
  paymentStatus: string;
  paymentMethod?: string;
  notes?: string;
  createdAt: string;
  payments: Payment[];
  paidMinor: number;
  dueMinor: number;
}

export type FulfillmentType = "dine_in" | "pickup" | "delivery";

export interface PosOrderInput {
  branchId?: string;
  clientRef: string;
  fulfillmentType: FulfillmentType;
  lines: LineInput[];
  discount?: Discount;
  tableLabel?: string;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
  payment?: { method: "cash" | "card"; tenderedMinor?: number; reference?: string };
}

export interface DayReport {
  date: string;
  branch: { id: string; name: string };
  orders: number;
  cancelled: number;
  grossMinor: number;
  vatMinor: number;
  discountMinor: number;
  averageMinor: number;
  collectedMinor: number;
  unpaidMinor: number;
  byMethod: Array<{ method: string; amountMinor: number; count: number }>;
  bySource: Array<{ source: string; orders: number; grossMinor: number }>;
  byType: Array<{ type: string; orders: number; grossMinor: number }>;
  topItems: Array<{ title: string; quantity: number; grossMinor: number }>;
  currency: string;
}

export interface PosCustomer {
  id: string;
  name?: string;
  phone?: string;
  orders: number;
  spentMinor: number;
  lastOrderAt: string;
}

export interface HeldTicket {
  id: string;
  branchId: string;
  label?: string;
  payload: unknown;
  createdAt: string;
}

export const posQuote = (input: { lines: LineInput[]; fulfillmentType: FulfillmentType; discount?: Discount }) => call<Quote>("/merchant/pos/quote", json(input));
export const posCreateOrder = (input: PosOrderInput) => call<PosOrder>("/merchant/pos/orders", json(input));
export const posPay = (orderId: string, input: { method: "cash" | "card"; amountMinor?: number; tenderedMinor?: number; reference?: string }) =>
  call<PosOrder>(`/merchant/pos/orders/${encodeURIComponent(orderId)}/payments`, json(input));
export const posOrders = (opts: { branchId?: string; date?: string } = {}) => call<{ orders: PosOrder[] }>(`/merchant/pos/orders${qs(opts)}`);
export const posReport = (opts: { branchId?: string; date?: string } = {}) => call<DayReport>(`/merchant/pos/report${qs(opts)}`);
export const posCustomers = () => call<{ customers: PosCustomer[] }>("/merchant/pos/customers");
export const posHeld = (branchId?: string) => call<{ tickets: HeldTicket[] }>(`/merchant/pos/held${qs({ branchId })}`);
export const posHold = (input: { branchId?: string; label?: string; payload: Record<string, unknown> }) => call<HeldTicket>("/merchant/pos/held", json(input));
export const posRelease = (id: string) => call<void>(`/merchant/pos/held/${encodeURIComponent(id)}`, { method: "DELETE" });
/** Moves an order along its states from the till: cancel, complete and so on. */
export const orderEvent = (orderId: string, event: string) => call<unknown>(`/merchant/orders/${encodeURIComponent(orderId)}/transition`, json({ event }));

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

export type KitchenColumn = "new" | "preparing" | "ready" | "completed";

export interface KitchenLine {
  id: string;
  title: string;
  quantity: number;
  modifiers: string[];
  notes?: string;
  status: "queued" | "preparing" | "ready" | "served";
  stationId?: string;
}

export interface KitchenTicket {
  orderId: string;
  number: number;
  column: KitchenColumn;
  source: string;
  fulfillmentType: string;
  tableLabel?: string;
  contactName?: string;
  notes?: string;
  firedAt: string;
  startedAt?: string;
  readyAt?: string;
  completedAt?: string;
  lines: KitchenLine[];
}

export interface KitchenBoard {
  branch: { id: string; name: string };
  stations: Station[];
  stationId: string | null;
  tickets: KitchenTicket[];
  stats: { todayOrders: number; avgPrepSeconds: number | null; pending: number; completed: number };
  serverTime: string;
}

export const kdsBoard = (opts: { branchId?: string; stationId?: string } = {}) => call<KitchenBoard>(`/merchant/kds/board${qs(opts)}`);
export const kdsAdvance = (orderId: string, action: "start" | "ready" | "complete", stationId?: string) =>
  call<unknown>(`/merchant/kds/orders/${encodeURIComponent(orderId)}/advance`, json({ action, stationId }));
export const kdsSetLine = (orderId: string, itemId: string, status: "queued" | "preparing" | "ready") =>
  call<unknown>(`/merchant/kds/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`, json({ status }));

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export type StockKind = "ingredient" | "packaging" | "prepared" | "resale" | "supply";
export type BaseUnit = "g" | "ml" | "each";
export type StockStatus = "in_stock" | "low" | "out";
export const STOCK_KINDS: Record<StockKind, string> = { ingredient: "Ingredient", packaging: "Packaging (cups, lids, bags)", prepared: "Prepared in house", resale: "Bought to resell", supply: "Supplies" };

export interface StockRow {
  id: string;
  name: string;
  category?: string;
  kind: StockKind;
  baseUnit: BaseUnit;
  unitLabel: string;
  unitSize: number;
  reorderLevel: number;
  costMinor: number;
  isActive: boolean;
  onHand: number;
  status: StockStatus;
  valueMinor: number;
}

export interface InventoryOverview {
  branch: { id: string; name: string };
  items: StockRow[];
  categories: string[];
  totals: { items: number; valueMinor: number; low: number; out: number };
  currency: string;
}

export interface StockItemInput {
  name: string;
  category?: string | null;
  kind?: StockKind;
  baseUnit?: BaseUnit;
  unitLabel?: string;
  unitSize?: number;
  reorderLevel?: number;
  costMinor?: number;
  isActive?: boolean;
}

export interface Movement {
  id: string;
  stockItemId: string;
  type: "sale" | "sale_reversal" | "purchase" | "adjustment" | "wastage" | "count";
  quantity: number;
  refType?: string;
  refId?: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
  itemName: string;
  unitLabel: string;
  units: number;
}

export interface RecipeLine {
  id?: string;
  offeringId?: string;
  stockItemId: string;
  quantity: number;
  modifierOptionId?: string;
  appliesTo?: "all" | "takeaway" | "dine_in";
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  leadDays?: number;
  isActive: boolean;
}

export interface PurchaseLine {
  stockItemId: string;
  quantity: number;
  unitCostMinor: number;
}

export interface Purchase {
  id: string;
  branchId: string;
  supplierId?: string;
  number: number;
  status: "draft" | "ordered" | "received" | "cancelled";
  lines: PurchaseLine[];
  notes?: string;
  totalMinor: number;
  orderedAt?: string;
  receivedAt?: string;
  createdAt: string;
}

export interface UsageReport {
  rows: Array<{ stockItemId: string; name: string; unitLabel: string; used: number; wasted: number; purchased: number; usedValueMinor: number; wastedValueMinor: number }>;
  totals: { usedValueMinor: number; wastedValueMinor: number; purchasedValueMinor: number };
}

export const invOverview = (branchId?: string) => call<InventoryOverview>(`/merchant/inventory/overview${qs({ branchId })}`);
export const invCreateItem = (input: StockItemInput & { openingStock?: number; branchId?: string }) => call<unknown>("/merchant/inventory/items", json(input));
export const invUpdateItem = (id: string, patch: Partial<StockItemInput>) => call<unknown>(`/merchant/inventory/items/${encodeURIComponent(id)}`, json(patch, "PATCH"));
export const invMovements = (opts: { branchId?: string; stockItemId?: string; types?: string } = {}) => call<{ movements: Movement[] }>(`/merchant/inventory/movements${qs(opts)}`);
export const invAdjust = (input: { branchId?: string; stockItemId: string; type: "adjustment" | "wastage" | "count"; quantity: number; note?: string }) =>
  call<unknown>("/merchant/inventory/adjustments", json(input));
export const invRecipes = () => call<{ lines: RecipeLine[] }>("/merchant/inventory/recipes");
export const invSetRecipe = (offeringId: string, lines: RecipeLine[]) => call<{ lines: RecipeLine[] }>(`/merchant/inventory/recipes/${encodeURIComponent(offeringId)}`, json({ lines }, "PUT"));
export const invSuppliers = () => call<{ suppliers: Supplier[] }>("/merchant/inventory/suppliers");
export const invCreateSupplier = (input: Omit<Supplier, "id" | "isActive">) => call<Supplier>("/merchant/inventory/suppliers", json(input));
export const invUpdateSupplier = (id: string, patch: Partial<Omit<Supplier, "id">>) => call<Supplier>(`/merchant/inventory/suppliers/${encodeURIComponent(id)}`, json(patch, "PATCH"));
export const invPurchases = (branchId?: string) => call<{ purchases: Purchase[] }>(`/merchant/inventory/purchases${qs({ branchId })}`);
export const invCreatePurchase = (input: { branchId?: string; supplierId?: string; lines: PurchaseLine[]; notes?: string; status?: "draft" | "ordered" }) => call<Purchase>("/merchant/inventory/purchases", json(input));
export const invReceivePurchase = (id: string) => call<Purchase>(`/merchant/inventory/purchases/${encodeURIComponent(id)}/receive`, json({}));
export const invCancelPurchase = (id: string) => call<Purchase>(`/merchant/inventory/purchases/${encodeURIComponent(id)}/cancel`, json({}));
export const invReport = (opts: { branchId?: string; from?: string; to?: string } = {}) => call<UsageReport>(`/merchant/inventory/report${qs(opts)}`);

// ---------------------------------------------------------------------------
// Public ordering site
// ---------------------------------------------------------------------------

export interface StoreOption {
  id: string;
  name: string;
  priceDeltaMinor: number;
}

export interface StoreGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: StoreOption[];
}

export interface StoreItem {
  id: string;
  categoryId?: string;
  name: string;
  description?: string;
  priceMinor: number;
  price: string;
  imageUrl?: string;
  modifierGroups: StoreGroup[];
}

export interface PublicStore {
  slug: string;
  name: string;
  language: string;
  languages: string[];
  theme: Theme;
  /** False for demo and unfinished shops: their pages ask search engines not to list them. */
  indexable: boolean;
  headline?: string;
  about?: string;
  heroImageUrl?: string;
  profile: { address?: string; mapsUrl?: string; phone?: string; hours?: string };
  currency: string;
  vatRate: number;
  vatInclusive: boolean;
  deliveryFeeMinor: number;
  fulfillmentTypes: string[];
  branches: Array<{ id: string; name: string; address?: string; phone?: string }>;
  categories: Array<{ id: string; name: string; items: StoreItem[] }>;
  featured: StoreItem[];
}

export interface TrackedOrder {
  number: number;
  status: string;
  statusLabel: string;
  step: number;
  steps: string[];
  fulfillmentType: string;
  branch?: { name: string; address?: string; phone?: string };
  placedAt: string;
  readyAt?: string;
  items: Array<{ title: string; quantity: number; modifiers: string[]; lineTotal: string }>;
  subtotal: string;
  deliveryFee?: string;
  discount?: string;
  vat: string;
  vatInclusive: boolean;
  total: string;
  paymentStatus: string;
  paymentMethod?: string;
}

export interface StoreOrderInput {
  clientRef: string;
  branchId?: string;
  fulfillmentType: "pickup" | "delivery";
  lines: LineInput[];
  name: string;
  phone: string;
  address?: string;
  notes?: string;
}

const store = (slug: string) => `/v1/store/${encodeURIComponent(slug)}`;
export const storeQuote = (slug: string, input: { lines: LineInput[]; fulfillmentType: "pickup" | "delivery" }) => call<Quote>(`${store(slug)}/quote`, json(input));
export const storeOrder = (slug: string, input: StoreOrderInput) => call<{ token: string; order: TrackedOrder }>(`${store(slug)}/orders`, json(input));
export const storeTrack = (slug: string, token: string) => call<TrackedOrder>(`${store(slug)}/orders/${encodeURIComponent(token)}`);
