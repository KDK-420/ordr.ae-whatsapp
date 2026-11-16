/**
 * Restaurant suite: types and repository ports shared by the Storefront, POS, KDS and Inventory
 * modules. See docs/MODULES_PLAN.md. Modules never call each other; they read and write through
 * these ports and react to order events.
 */

export const SUITE_MODULES = ["storefront", "pos", "kds", "inventory", "whatsapp"] as const;
export type SuiteModule = (typeof SUITE_MODULES)[number];

/** A kitchen station. A line goes to the station that lists its category, else to the first one. */
export interface Station {
  id: string;
  name: string;
  categoryIds: string[];
}

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  address?: string;
  phone?: string;
  stations: Station[];
  sortOrder: number;
  isActive: boolean;
}

export interface BranchInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  stations?: Station[];
  sortOrder?: number;
  isActive?: boolean;
}

export type PaymentMethod = "cash" | "card" | "online";

export interface OrderPaymentRecord {
  id: string;
  tenantId: string;
  orderId: string;
  branchId?: string;
  method: PaymentMethod;
  amountMinor: number;
  tenderedMinor?: number;
  changeMinor?: number;
  reference?: string;
  createdBy?: string;
  createdAt: string;
}

export interface HeldTicketRecord {
  id: string;
  tenantId: string;
  branchId: string;
  label?: string;
  /** The POS ticket exactly as the till held it; opaque to the server. */
  payload: unknown;
  createdBy?: string;
  createdAt: string;
}

/** Branches, payments and held tickets: the small tables every module leans on. */
export interface SuiteRepository {
  listBranches(tenantId: string, opts?: { includeInactive?: boolean }): Promise<Branch[]>;
  getBranch(tenantId: string, branchId: string): Promise<Branch | null>;
  createBranch(tenantId: string, input: BranchInput): Promise<Branch>;
  updateBranch(tenantId: string, branchId: string, patch: Partial<BranchInput>): Promise<Branch | null>;

  addPayment(input: Omit<OrderPaymentRecord, "id" | "createdAt">): Promise<OrderPaymentRecord>;
  listPayments(tenantId: string, opts: { orderId?: string; branchId?: string; from?: Date; to?: Date }): Promise<OrderPaymentRecord[]>;

  holdTicket(input: Omit<HeldTicketRecord, "id" | "createdAt">): Promise<HeldTicketRecord>;
  listHeldTickets(tenantId: string, branchId: string): Promise<HeldTicketRecord[]>;
  /** Removes a held ticket (resumed or discarded); true when it existed. */
  releaseTicket(tenantId: string, id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export type StockKind = "ingredient" | "packaging" | "prepared" | "resale" | "supply";
export type BaseUnit = "g" | "ml" | "each";
export type MovementType = "sale" | "sale_reversal" | "purchase" | "adjustment" | "wastage" | "count";
/** When a recipe line applies: always, only when the order leaves the shop, or only when eaten in. */
export type RecipeScope = "all" | "takeaway" | "dine_in";

export interface StockItem {
  id: string;
  tenantId: string;
  name: string;
  category?: string;
  kind: StockKind;
  baseUnit: BaseUnit;
  /** How it is bought and shown: "1kg", "1L", "sleeve of 50". */
  unitLabel: string;
  /** Base units in one stock unit. */
  unitSize: number;
  /** In stock units. */
  reorderLevel: number;
  /** Last cost of one stock unit. */
  costMinor: number;
  isActive: boolean;
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

export interface StockMovement {
  id: string;
  tenantId: string;
  branchId: string;
  stockItemId: string;
  type: MovementType;
  /** Signed, in base units. */
  quantity: number;
  unitCostMinor?: number;
  refType?: string;
  refId?: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
}

export interface RecipeLine {
  id: string;
  tenantId: string;
  offeringId: string;
  /** Set when the line applies only if this modifier option was chosen (a size, an extra). */
  modifierOptionId?: string;
  stockItemId: string;
  /** Base units per one sold. */
  quantity: number;
  appliesTo: RecipeScope;
}

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  leadDays?: number;
  isActive: boolean;
}

export interface PurchaseLine {
  stockItemId: string;
  /** In stock units. */
  quantity: number;
  unitCostMinor: number;
}

export type PurchaseStatus = "draft" | "ordered" | "received" | "cancelled";

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  branchId: string;
  supplierId?: string;
  number: number;
  status: PurchaseStatus;
  lines: PurchaseLine[];
  notes?: string;
  totalMinor: number;
  orderedAt?: string;
  receivedAt?: string;
  createdBy?: string;
  createdAt: string;
}

export interface InventoryRepository {
  listItems(tenantId: string, opts?: { includeInactive?: boolean }): Promise<StockItem[]>;
  getItem(tenantId: string, id: string): Promise<StockItem | null>;
  createItem(tenantId: string, input: StockItemInput & { id?: string }): Promise<StockItem>;
  updateItem(tenantId: string, id: string, patch: Partial<StockItemInput>): Promise<StockItem | null>;

  /** On-hand per item for a branch, in base units; items with no movements are absent. */
  levels(tenantId: string, branchId: string): Promise<Map<string, number>>;
  /** Appends movements and moves the cached levels with them, all or nothing. */
  move(movements: Array<Omit<StockMovement, "id" | "createdAt">>): Promise<StockMovement[]>;
  listMovements(tenantId: string, opts: { branchId?: string; stockItemId?: string; types?: MovementType[]; refType?: string; refId?: string; from?: Date; to?: Date; limit?: number }): Promise<StockMovement[]>;

  recipe(tenantId: string, offeringId: string): Promise<RecipeLine[]>;
  /** Every recipe line of the tenant, for deductions that span a whole order. */
  recipes(tenantId: string, offeringIds?: string[]): Promise<RecipeLine[]>;
  /** Replaces the recipe of one menu item. */
  setRecipe(tenantId: string, offeringId: string, lines: Array<Omit<RecipeLine, "id" | "tenantId" | "offeringId">>): Promise<RecipeLine[]>;

  listSuppliers(tenantId: string): Promise<Supplier[]>;
  createSupplier(tenantId: string, input: Omit<Supplier, "id" | "tenantId" | "isActive"> & { id?: string; isActive?: boolean }): Promise<Supplier>;
  updateSupplier(tenantId: string, id: string, patch: Partial<Omit<Supplier, "id" | "tenantId">>): Promise<Supplier | null>;

  listPurchases(tenantId: string, opts?: { branchId?: string }): Promise<PurchaseOrder[]>;
  getPurchase(tenantId: string, id: string): Promise<PurchaseOrder | null>;
  createPurchase(input: Omit<PurchaseOrder, "id" | "number" | "createdAt">): Promise<PurchaseOrder>;
  updatePurchase(tenantId: string, id: string, patch: Partial<Pick<PurchaseOrder, "status" | "lines" | "notes" | "totalMinor" | "supplierId" | "orderedAt" | "receivedAt">>): Promise<PurchaseOrder | null>;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export const SWATCHES = ["espresso", "olive_grove", "chili", "ocean", "midnight", "custom"] as const;
export type SwatchId = (typeof SWATCHES)[number];

/** The resolved colours a storefront and the staff apps paint with. */
export interface ThemeColors {
  /** Buttons and active states; white text sits on it. */
  primary: string;
  /** Highlights such as badges; dark text sits on it. */
  accent: string;
  /** Dark chrome: staff sidebars, storefront footers. */
  ink: string;
  background: string;
  text: string;
}

export interface TenantTheme extends ThemeColors {
  swatch: SwatchId;
  logoUrl?: string;
  coverImageUrl?: string;
  tagline?: string;
}

export const SWATCH_COLORS: Record<Exclude<SwatchId, "custom">, ThemeColors> = {
  espresso: { primary: "#B4531F", accent: "#E9B87A", ink: "#2B1D14", background: "#FAF6F1", text: "#2B1D14" },
  olive_grove: { primary: "#3F5F3A", accent: "#D9A441", ink: "#1F2A1C", background: "#F7F7F0", text: "#1F2A1C" },
  chili: { primary: "#B3261E", accent: "#F2A33A", ink: "#2A1512", background: "#FFF8F5", text: "#2A1512" },
  ocean: { primary: "#0E5E6F", accent: "#F08A5D", ink: "#0F2A30", background: "#F4FAFB", text: "#0F2A30" },
  midnight: { primary: "#1F2937", accent: "#E0B354", ink: "#111827", background: "#F8F8F7", text: "#111827" },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The theme stored in `tenant.settings.theme`, completed from its swatch; Espresso when nothing is set. */
export function tenantTheme(settings: Record<string, unknown>): TenantTheme {
  const raw = (settings.theme && typeof settings.theme === "object" ? settings.theme : {}) as Record<string, unknown>;
  const swatch = (SWATCHES as readonly string[]).includes(String(raw.swatch)) ? (raw.swatch as SwatchId) : "espresso";
  const base = SWATCH_COLORS[swatch === "custom" ? "espresso" : swatch];
  const color = (key: keyof ThemeColors) => (swatch === "custom" && typeof raw[key] === "string" && HEX.test(raw[key] as string) ? (raw[key] as string) : base[key]);
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { swatch, primary: color("primary"), accent: color("accent"), ink: color("ink"), background: color("background"), text: color("text"), logoUrl: text(raw.logoUrl), coverImageUrl: text(raw.coverImageUrl), tagline: text(raw.tagline) };
}

/** The suite modules a tenant has, from `tenant.settings.modules`. Tenants from before the suite have WhatsApp only. */
export function tenantModules(settings: Record<string, unknown>): SuiteModule[] {
  const raw = settings.modules;
  if (!Array.isArray(raw)) return ["whatsapp"];
  return SUITE_MODULES.filter((m) => raw.includes(m));
}
