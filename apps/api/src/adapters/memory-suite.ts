import type {
  Branch,
  BranchInput,
  HeldTicketRecord,
  InventoryRepository,
  MovementType,
  OrderPaymentRecord,
  PurchaseOrder,
  RecipeLine,
  StockItem,
  StockItemInput,
  StockMovement,
  SuiteRepository,
  Supplier,
} from "../suite/types";

let seq = 0;
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${++seq}`;

export class InMemorySuiteRepository implements SuiteRepository {
  readonly payments: OrderPaymentRecord[] = [];
  readonly held: HeldTicketRecord[] = [];

  constructor(readonly branches: Branch[] = []) {}

  async listBranches(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<Branch[]> {
    return this.branches
      .filter((b) => b.tenantId === tenantId && (opts.includeInactive || b.isActive))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((b) => structuredClone(b));
  }

  async getBranch(tenantId: string, branchId: string): Promise<Branch | null> {
    const b = this.branches.find((x) => x.tenantId === tenantId && x.id === branchId);
    return b ? structuredClone(b) : null;
  }

  async createBranch(tenantId: string, input: BranchInput): Promise<Branch> {
    const b: Branch = { id: nextId("br"), tenantId, name: input.name, address: input.address ?? undefined, phone: input.phone ?? undefined, stations: structuredClone(input.stations ?? []), sortOrder: input.sortOrder ?? this.branches.filter((x) => x.tenantId === tenantId).length, isActive: input.isActive ?? true };
    this.branches.push(b);
    return structuredClone(b);
  }

  async updateBranch(tenantId: string, branchId: string, patch: Partial<BranchInput>): Promise<Branch | null> {
    const b = this.branches.find((x) => x.tenantId === tenantId && x.id === branchId);
    if (!b) return null;
    if (patch.name) b.name = patch.name;
    if (patch.address !== undefined) b.address = patch.address ?? undefined;
    if (patch.phone !== undefined) b.phone = patch.phone ?? undefined;
    if (patch.stations) b.stations = structuredClone(patch.stations);
    if (patch.sortOrder !== undefined) b.sortOrder = patch.sortOrder;
    if (patch.isActive !== undefined) b.isActive = patch.isActive;
    return structuredClone(b);
  }

  async addPayment(input: Omit<OrderPaymentRecord, "id" | "createdAt">): Promise<OrderPaymentRecord> {
    const p: OrderPaymentRecord = { ...input, id: nextId("pay"), createdAt: new Date().toISOString() };
    this.payments.push(p);
    return { ...p };
  }

  async listPayments(tenantId: string, opts: { orderId?: string; branchId?: string; from?: Date; to?: Date }): Promise<OrderPaymentRecord[]> {
    return this.payments
      .filter((p) => p.tenantId === tenantId)
      .filter((p) => !opts.orderId || p.orderId === opts.orderId)
      .filter((p) => !opts.branchId || p.branchId === opts.branchId)
      .filter((p) => !opts.from || new Date(p.createdAt) >= opts.from)
      .filter((p) => !opts.to || new Date(p.createdAt) < opts.to)
      .map((p) => ({ ...p }));
  }

  async holdTicket(input: Omit<HeldTicketRecord, "id" | "createdAt">): Promise<HeldTicketRecord> {
    const t: HeldTicketRecord = { ...structuredClone(input), id: nextId("held"), createdAt: new Date().toISOString() };
    this.held.push(t);
    return structuredClone(t);
  }

  async listHeldTickets(tenantId: string, branchId: string): Promise<HeldTicketRecord[]> {
    return this.held.filter((t) => t.tenantId === tenantId && t.branchId === branchId).map((t) => structuredClone(t));
  }

  async releaseTicket(tenantId: string, id: string): Promise<boolean> {
    const i = this.held.findIndex((t) => t.tenantId === tenantId && t.id === id);
    if (i < 0) return false;
    this.held.splice(i, 1);
    return true;
  }
}

export class InMemoryInventoryRepository implements InventoryRepository {
  readonly movements: StockMovement[] = [];
  readonly onHand = new Map<string, number>();
  readonly suppliers: Supplier[] = [];
  readonly purchases: PurchaseOrder[] = [];
  private readonly purchaseSeq = new Map<string, number>();

  constructor(
    readonly items: StockItem[] = [],
    readonly recipeLines: RecipeLine[] = [],
  ) {}

  async listItems(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<StockItem[]> {
    return this.items
      .filter((i) => i.tenantId === tenantId && (opts.includeInactive || i.isActive))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((i) => ({ ...i }));
  }

  async getItem(tenantId: string, id: string): Promise<StockItem | null> {
    const i = this.items.find((x) => x.tenantId === tenantId && x.id === id);
    return i ? { ...i } : null;
  }

  async createItem(tenantId: string, input: StockItemInput & { id?: string }): Promise<StockItem> {
    const item: StockItem = {
      id: input.id ?? nextId("stk"),
      tenantId,
      name: input.name,
      category: input.category ?? undefined,
      kind: input.kind ?? "ingredient",
      baseUnit: input.baseUnit ?? "each",
      unitLabel: input.unitLabel ?? "",
      unitSize: input.unitSize ?? 1,
      reorderLevel: input.reorderLevel ?? 0,
      costMinor: input.costMinor ?? 0,
      isActive: input.isActive ?? true,
    };
    this.items.push(item);
    return { ...item };
  }

  async updateItem(tenantId: string, id: string, patch: Partial<StockItemInput>): Promise<StockItem | null> {
    const i = this.items.find((x) => x.tenantId === tenantId && x.id === id);
    if (!i) return null;
    if (patch.name) i.name = patch.name;
    if (patch.category !== undefined) i.category = patch.category ?? undefined;
    if (patch.kind) i.kind = patch.kind;
    if (patch.baseUnit) i.baseUnit = patch.baseUnit;
    if (patch.unitLabel !== undefined) i.unitLabel = patch.unitLabel;
    if (patch.unitSize !== undefined) i.unitSize = patch.unitSize;
    if (patch.reorderLevel !== undefined) i.reorderLevel = patch.reorderLevel;
    if (patch.costMinor !== undefined) i.costMinor = patch.costMinor;
    if (patch.isActive !== undefined) i.isActive = patch.isActive;
    return { ...i };
  }

  async levels(tenantId: string, branchId: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const prefix = `${tenantId}:${branchId}:`;
    for (const [key, value] of this.onHand) if (key.startsWith(prefix)) out.set(key.slice(prefix.length), value);
    return out;
  }

  async move(movements: Array<Omit<StockMovement, "id" | "createdAt">>): Promise<StockMovement[]> {
    const now = new Date().toISOString();
    const out: StockMovement[] = [];
    for (const m of movements) {
      const rec: StockMovement = { ...m, id: nextId("mov"), createdAt: now };
      this.movements.push(rec);
      const key = `${m.tenantId}:${m.branchId}:${m.stockItemId}`;
      this.onHand.set(key, (this.onHand.get(key) ?? 0) + m.quantity);
      out.push({ ...rec });
    }
    return out;
  }

  async listMovements(tenantId: string, opts: { branchId?: string; stockItemId?: string; types?: MovementType[]; refType?: string; refId?: string; from?: Date; to?: Date; limit?: number }): Promise<StockMovement[]> {
    return this.movements
      .filter((m) => m.tenantId === tenantId)
      .filter((m) => !opts.branchId || m.branchId === opts.branchId)
      .filter((m) => !opts.stockItemId || m.stockItemId === opts.stockItemId)
      .filter((m) => !opts.types || opts.types.includes(m.type))
      .filter((m) => !opts.refType || m.refType === opts.refType)
      .filter((m) => !opts.refId || m.refId === opts.refId)
      .filter((m) => !opts.from || new Date(m.createdAt) >= opts.from)
      .filter((m) => !opts.to || new Date(m.createdAt) < opts.to)
      .slice()
      .reverse()
      .slice(0, opts.limit ?? 500)
      .map((m) => ({ ...m }));
  }

  async recipe(tenantId: string, offeringId: string): Promise<RecipeLine[]> {
    return this.recipeLines.filter((l) => l.tenantId === tenantId && l.offeringId === offeringId).map((l) => ({ ...l }));
  }

  async recipes(tenantId: string, offeringIds?: string[]): Promise<RecipeLine[]> {
    const wanted = offeringIds ? new Set(offeringIds) : null;
    return this.recipeLines.filter((l) => l.tenantId === tenantId && (!wanted || wanted.has(l.offeringId))).map((l) => ({ ...l }));
  }

  async setRecipe(tenantId: string, offeringId: string, lines: Array<Omit<RecipeLine, "id" | "tenantId" | "offeringId">>): Promise<RecipeLine[]> {
    for (let i = this.recipeLines.length - 1; i >= 0; i--) {
      const l = this.recipeLines[i]!;
      if (l.tenantId === tenantId && l.offeringId === offeringId) this.recipeLines.splice(i, 1);
    }
    const created = lines.map((l): RecipeLine => ({ ...l, id: nextId("rcp"), tenantId, offeringId }));
    this.recipeLines.push(...created);
    return created.map((l) => ({ ...l }));
  }

  async listSuppliers(tenantId: string): Promise<Supplier[]> {
    return this.suppliers.filter((s) => s.tenantId === tenantId).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ ...s }));
  }

  async createSupplier(tenantId: string, input: Omit<Supplier, "id" | "tenantId" | "isActive"> & { id?: string; isActive?: boolean }): Promise<Supplier> {
    const s: Supplier = { ...input, id: input.id ?? nextId("sup"), tenantId, isActive: input.isActive ?? true };
    this.suppliers.push(s);
    return { ...s };
  }

  async updateSupplier(tenantId: string, id: string, patch: Partial<Omit<Supplier, "id" | "tenantId">>): Promise<Supplier | null> {
    const s = this.suppliers.find((x) => x.tenantId === tenantId && x.id === id);
    if (!s) return null;
    Object.assign(s, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return { ...s };
  }

  async listPurchases(tenantId: string, opts: { branchId?: string } = {}): Promise<PurchaseOrder[]> {
    return this.purchases
      .filter((p) => p.tenantId === tenantId && (!opts.branchId || p.branchId === opts.branchId))
      .slice()
      .reverse()
      .map((p) => structuredClone(p));
  }

  async getPurchase(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const p = this.purchases.find((x) => x.tenantId === tenantId && x.id === id);
    return p ? structuredClone(p) : null;
  }

  async createPurchase(input: Omit<PurchaseOrder, "id" | "number" | "createdAt">): Promise<PurchaseOrder> {
    const number = (this.purchaseSeq.get(input.tenantId) ?? 0) + 1;
    this.purchaseSeq.set(input.tenantId, number);
    const p: PurchaseOrder = { ...structuredClone(input), id: nextId("po"), number, createdAt: new Date().toISOString() };
    this.purchases.push(p);
    return structuredClone(p);
  }

  async updatePurchase(tenantId: string, id: string, patch: Partial<Pick<PurchaseOrder, "status" | "lines" | "notes" | "totalMinor" | "supplierId" | "orderedAt" | "receivedAt">>): Promise<PurchaseOrder | null> {
    const p = this.purchases.find((x) => x.tenantId === tenantId && x.id === id);
    if (!p) return null;
    Object.assign(p, structuredClone(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))));
    return structuredClone(p);
  }
}
