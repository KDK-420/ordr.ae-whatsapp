import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  BaseUnit,
  Branch,
  BranchInput,
  HeldTicketRecord,
  InventoryRepository,
  MovementType,
  OrderPaymentRecord,
  PaymentMethod,
  PurchaseLine,
  PurchaseOrder,
  PurchaseStatus,
  RecipeLine,
  RecipeScope,
  Station,
  StockItem,
  StockItemInput,
  StockKind,
  StockMovement,
  SuiteRepository,
  Supplier,
} from "../suite/types";

const stations = (v: Prisma.JsonValue): Station[] =>
  Array.isArray(v)
    ? v.flatMap((s) => {
        const o = s as { id?: unknown; name?: unknown; categoryIds?: unknown } | null;
        if (!o || typeof o.id !== "string" || typeof o.name !== "string") return [];
        return [{ id: o.id, name: o.name, categoryIds: Array.isArray(o.categoryIds) ? o.categoryIds.filter((c): c is string => typeof c === "string") : [] }];
      })
    : [];

const toBranch = (r: Prisma.BranchGetPayload<Record<string, never>>): Branch => ({ id: r.id, tenantId: r.tenantId, name: r.name, address: r.address ?? undefined, phone: r.phone ?? undefined, stations: stations(r.stations), sortOrder: r.sortOrder, isActive: r.isActive });

const toPayment = (r: Prisma.OrderPaymentGetPayload<Record<string, never>>): OrderPaymentRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  orderId: r.orderId,
  branchId: r.branchId ?? undefined,
  method: r.method as PaymentMethod,
  amountMinor: r.amountMinor,
  tenderedMinor: r.tenderedMinor ?? undefined,
  changeMinor: r.changeMinor ?? undefined,
  reference: r.reference ?? undefined,
  createdBy: r.createdBy ?? undefined,
  createdAt: r.createdAt.toISOString(),
});

const toHeld = (r: Prisma.HeldTicketGetPayload<Record<string, never>>): HeldTicketRecord => ({ id: r.id, tenantId: r.tenantId, branchId: r.branchId, label: r.label ?? undefined, payload: r.payload, createdBy: r.createdBy ?? undefined, createdAt: r.createdAt.toISOString() });

export class PrismaSuiteRepository implements SuiteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listBranches(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<Branch[]> {
    const rows = await this.prisma.branch.findMany({ where: { tenantId, ...(opts.includeInactive ? {} : { isActive: true }) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return rows.map(toBranch);
  }

  async getBranch(tenantId: string, branchId: string): Promise<Branch | null> {
    const r = await this.prisma.branch.findFirst({ where: { tenantId, id: branchId } });
    return r ? toBranch(r) : null;
  }

  async createBranch(tenantId: string, input: BranchInput): Promise<Branch> {
    const sortOrder = input.sortOrder ?? (await this.prisma.branch.count({ where: { tenantId } }));
    return toBranch(await this.prisma.branch.create({ data: { tenantId, name: input.name, address: input.address ?? null, phone: input.phone ?? null, stations: (input.stations ?? []) as unknown as Prisma.InputJsonValue, sortOrder, isActive: input.isActive ?? true } }));
  }

  async updateBranch(tenantId: string, branchId: string, patch: Partial<BranchInput>): Promise<Branch | null> {
    const existing = await this.prisma.branch.findFirst({ where: { tenantId, id: branchId } });
    if (!existing) return null;
    return toBranch(
      await this.prisma.branch.update({
        where: { id: branchId },
        data: {
          ...(patch.name ? { name: patch.name } : {}),
          ...(patch.address !== undefined ? { address: patch.address } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.stations ? { stations: patch.stations as unknown as Prisma.InputJsonValue } : {}),
          ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      }),
    );
  }

  async addPayment(input: Omit<OrderPaymentRecord, "id" | "createdAt">): Promise<OrderPaymentRecord> {
    return toPayment(await this.prisma.orderPayment.create({ data: { tenantId: input.tenantId, orderId: input.orderId, branchId: input.branchId ?? null, method: input.method, amountMinor: input.amountMinor, tenderedMinor: input.tenderedMinor ?? null, changeMinor: input.changeMinor ?? null, reference: input.reference ?? null, createdBy: input.createdBy ?? null } }));
  }

  async listPayments(tenantId: string, opts: { orderId?: string; branchId?: string; from?: Date; to?: Date }): Promise<OrderPaymentRecord[]> {
    const rows = await this.prisma.orderPayment.findMany({
      where: { tenantId, ...(opts.orderId ? { orderId: opts.orderId } : {}), ...(opts.branchId ? { branchId: opts.branchId } : {}), ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPayment);
  }

  async holdTicket(input: Omit<HeldTicketRecord, "id" | "createdAt">): Promise<HeldTicketRecord> {
    return toHeld(await this.prisma.heldTicket.create({ data: { tenantId: input.tenantId, branchId: input.branchId, label: input.label ?? null, payload: input.payload as Prisma.InputJsonValue, createdBy: input.createdBy ?? null } }));
  }

  async listHeldTickets(tenantId: string, branchId: string): Promise<HeldTicketRecord[]> {
    const rows = await this.prisma.heldTicket.findMany({ where: { tenantId, branchId }, orderBy: { createdAt: "asc" } });
    return rows.map(toHeld);
  }

  async releaseTicket(tenantId: string, id: string): Promise<boolean> {
    const res = await this.prisma.heldTicket.deleteMany({ where: { tenantId, id } });
    return res.count > 0;
  }
}

const toItem = (r: Prisma.StockItemGetPayload<Record<string, never>>): StockItem => ({
  id: r.id,
  tenantId: r.tenantId,
  name: r.name,
  category: r.category ?? undefined,
  kind: r.kind as StockKind,
  baseUnit: r.baseUnit as BaseUnit,
  unitLabel: r.unitLabel,
  unitSize: r.unitSize,
  reorderLevel: r.reorderLevel,
  costMinor: r.costMinor,
  isActive: r.isActive,
});

const toMovement = (r: Prisma.StockMovementGetPayload<Record<string, never>>): StockMovement => ({
  id: r.id,
  tenantId: r.tenantId,
  branchId: r.branchId,
  stockItemId: r.stockItemId,
  type: r.type as MovementType,
  quantity: r.quantity,
  unitCostMinor: r.unitCostMinor ?? undefined,
  refType: r.refType ?? undefined,
  refId: r.refId ?? undefined,
  note: r.note ?? undefined,
  createdBy: r.createdBy ?? undefined,
  createdAt: r.createdAt.toISOString(),
});

const toRecipeLine = (r: Prisma.RecipeLineGetPayload<Record<string, never>>): RecipeLine => ({ id: r.id, tenantId: r.tenantId, offeringId: r.offeringId, modifierOptionId: r.modifierOptionId ?? undefined, stockItemId: r.stockItemId, quantity: r.quantity, appliesTo: r.appliesTo as RecipeScope });

const toSupplier = (r: Prisma.SupplierGetPayload<Record<string, never>>): Supplier => ({ id: r.id, tenantId: r.tenantId, name: r.name, phone: r.phone ?? undefined, email: r.email ?? undefined, notes: r.notes ?? undefined, leadDays: r.leadDays ?? undefined, isActive: r.isActive });

const purchaseLines = (v: Prisma.JsonValue): PurchaseLine[] =>
  Array.isArray(v)
    ? v.flatMap((l) => {
        const o = l as { stockItemId?: unknown; quantity?: unknown; unitCostMinor?: unknown } | null;
        return o && typeof o.stockItemId === "string" && typeof o.quantity === "number" ? [{ stockItemId: o.stockItemId, quantity: o.quantity, unitCostMinor: typeof o.unitCostMinor === "number" ? o.unitCostMinor : 0 }] : [];
      })
    : [];

const toPurchase = (r: Prisma.PurchaseOrderGetPayload<Record<string, never>>): PurchaseOrder => ({
  id: r.id,
  tenantId: r.tenantId,
  branchId: r.branchId,
  supplierId: r.supplierId ?? undefined,
  number: r.number,
  status: r.status as PurchaseStatus,
  lines: purchaseLines(r.lines),
  notes: r.notes ?? undefined,
  totalMinor: r.totalMinor,
  orderedAt: r.orderedAt?.toISOString(),
  receivedAt: r.receivedAt?.toISOString(),
  createdBy: r.createdBy ?? undefined,
  createdAt: r.createdAt.toISOString(),
});

export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listItems(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<StockItem[]> {
    const rows = await this.prisma.stockItem.findMany({ where: { tenantId, ...(opts.includeInactive ? {} : { isActive: true }) }, orderBy: { name: "asc" } });
    return rows.map(toItem);
  }

  async getItem(tenantId: string, id: string): Promise<StockItem | null> {
    const r = await this.prisma.stockItem.findFirst({ where: { tenantId, id } });
    return r ? toItem(r) : null;
  }

  async createItem(tenantId: string, input: StockItemInput & { id?: string }): Promise<StockItem> {
    return toItem(
      await this.prisma.stockItem.create({
        data: { ...(input.id ? { id: input.id } : {}), tenantId, name: input.name, category: input.category ?? null, kind: input.kind ?? "ingredient", baseUnit: input.baseUnit ?? "each", unitLabel: input.unitLabel ?? "", unitSize: input.unitSize ?? 1, reorderLevel: input.reorderLevel ?? 0, costMinor: input.costMinor ?? 0, isActive: input.isActive ?? true },
      }),
    );
  }

  async updateItem(tenantId: string, id: string, patch: Partial<StockItemInput>): Promise<StockItem | null> {
    const existing = await this.prisma.stockItem.findFirst({ where: { tenantId, id } });
    if (!existing) return null;
    return toItem(
      await this.prisma.stockItem.update({
        where: { id },
        data: {
          ...(patch.name ? { name: patch.name } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : {}),
          ...(patch.kind ? { kind: patch.kind } : {}),
          ...(patch.baseUnit ? { baseUnit: patch.baseUnit } : {}),
          ...(patch.unitLabel !== undefined ? { unitLabel: patch.unitLabel } : {}),
          ...(patch.unitSize !== undefined ? { unitSize: patch.unitSize } : {}),
          ...(patch.reorderLevel !== undefined ? { reorderLevel: patch.reorderLevel } : {}),
          ...(patch.costMinor !== undefined ? { costMinor: patch.costMinor } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      }),
    );
  }

  async levels(tenantId: string, branchId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.stockLevel.findMany({ where: { tenantId, branchId }, select: { stockItemId: true, onHand: true } });
    return new Map(rows.map((r) => [r.stockItemId, r.onHand]));
  }

  /** Ledger rows and the cached level move in one transaction; the increment is atomic, so concurrent sales cannot lose an update. */
  async move(movements: Array<Omit<StockMovement, "id" | "createdAt">>): Promise<StockMovement[]> {
    if (movements.length === 0) return [];
    return this.prisma.$transaction(async (tx) => {
      const out: StockMovement[] = [];
      for (const m of movements) {
        const row = await tx.stockMovement.create({
          data: { tenantId: m.tenantId, branchId: m.branchId, stockItemId: m.stockItemId, type: m.type, quantity: m.quantity, unitCostMinor: m.unitCostMinor ?? null, refType: m.refType ?? null, refId: m.refId ?? null, note: m.note ?? null, createdBy: m.createdBy ?? null },
        });
        await tx.stockLevel.upsert({
          where: { branchId_stockItemId: { branchId: m.branchId, stockItemId: m.stockItemId } },
          create: { branchId: m.branchId, stockItemId: m.stockItemId, tenantId: m.tenantId, onHand: m.quantity },
          update: { onHand: { increment: m.quantity } },
        });
        out.push(toMovement(row));
      }
      return out;
    });
  }

  async listMovements(tenantId: string, opts: { branchId?: string; stockItemId?: string; types?: MovementType[]; refType?: string; refId?: string; from?: Date; to?: Date; limit?: number }): Promise<StockMovement[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        tenantId,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        ...(opts.stockItemId ? { stockItemId: opts.stockItemId } : {}),
        ...(opts.types ? { type: { in: opts.types } } : {}),
        ...(opts.refType ? { refType: opts.refType } : {}),
        ...(opts.refId ? { refId: opts.refId } : {}),
        ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 500,
    });
    return rows.map(toMovement);
  }

  async recipe(tenantId: string, offeringId: string): Promise<RecipeLine[]> {
    return (await this.prisma.recipeLine.findMany({ where: { tenantId, offeringId } })).map(toRecipeLine);
  }

  async recipes(tenantId: string, offeringIds?: string[]): Promise<RecipeLine[]> {
    return (await this.prisma.recipeLine.findMany({ where: { tenantId, ...(offeringIds ? { offeringId: { in: offeringIds } } : {}) } })).map(toRecipeLine);
  }

  async setRecipe(tenantId: string, offeringId: string, lines: Array<Omit<RecipeLine, "id" | "tenantId" | "offeringId">>): Promise<RecipeLine[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.recipeLine.deleteMany({ where: { tenantId, offeringId } });
      const out: RecipeLine[] = [];
      for (const l of lines) out.push(toRecipeLine(await tx.recipeLine.create({ data: { tenantId, offeringId, modifierOptionId: l.modifierOptionId ?? null, stockItemId: l.stockItemId, quantity: l.quantity, appliesTo: l.appliesTo } })));
      return out;
    });
  }

  async listSuppliers(tenantId: string): Promise<Supplier[]> {
    return (await this.prisma.supplier.findMany({ where: { tenantId }, orderBy: { name: "asc" } })).map(toSupplier);
  }

  async createSupplier(tenantId: string, input: Omit<Supplier, "id" | "tenantId" | "isActive"> & { id?: string; isActive?: boolean }): Promise<Supplier> {
    return toSupplier(await this.prisma.supplier.create({ data: { ...(input.id ? { id: input.id } : {}), tenantId, name: input.name, phone: input.phone ?? null, email: input.email ?? null, notes: input.notes ?? null, leadDays: input.leadDays ?? null, isActive: input.isActive ?? true } }));
  }

  async updateSupplier(tenantId: string, id: string, patch: Partial<Omit<Supplier, "id" | "tenantId">>): Promise<Supplier | null> {
    const existing = await this.prisma.supplier.findFirst({ where: { tenantId, id } });
    if (!existing) return null;
    return toSupplier(
      await this.prisma.supplier.update({
        where: { id },
        data: { ...(patch.name ? { name: patch.name } : {}), ...(patch.phone !== undefined ? { phone: patch.phone } : {}), ...(patch.email !== undefined ? { email: patch.email } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.leadDays !== undefined ? { leadDays: patch.leadDays } : {}), ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}) },
      }),
    );
  }

  async listPurchases(tenantId: string, opts: { branchId?: string } = {}): Promise<PurchaseOrder[]> {
    return (await this.prisma.purchaseOrder.findMany({ where: { tenantId, ...(opts.branchId ? { branchId: opts.branchId } : {}) }, orderBy: { createdAt: "desc" } })).map(toPurchase);
  }

  async getPurchase(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const r = await this.prisma.purchaseOrder.findFirst({ where: { tenantId, id } });
    return r ? toPurchase(r) : null;
  }

  async createPurchase(input: Omit<PurchaseOrder, "id" | "number" | "createdAt">): Promise<PurchaseOrder> {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.purchaseOrder.findFirst({ where: { tenantId: input.tenantId }, orderBy: { number: "desc" }, select: { number: true } });
      return toPurchase(
        await tx.purchaseOrder.create({
          data: { tenantId: input.tenantId, branchId: input.branchId, supplierId: input.supplierId ?? null, number: (last?.number ?? 0) + 1, status: input.status, lines: input.lines as unknown as Prisma.InputJsonValue, notes: input.notes ?? null, totalMinor: input.totalMinor, orderedAt: input.orderedAt ? new Date(input.orderedAt) : null, receivedAt: input.receivedAt ? new Date(input.receivedAt) : null, createdBy: input.createdBy ?? null },
        }),
      );
    });
  }

  async updatePurchase(tenantId: string, id: string, patch: Partial<Pick<PurchaseOrder, "status" | "lines" | "notes" | "totalMinor" | "supplierId" | "orderedAt" | "receivedAt">>): Promise<PurchaseOrder | null> {
    const existing = await this.prisma.purchaseOrder.findFirst({ where: { tenantId, id } });
    if (!existing) return null;
    return toPurchase(
      await this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.lines ? { lines: patch.lines as unknown as Prisma.InputJsonValue } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.totalMinor !== undefined ? { totalMinor: patch.totalMinor } : {}),
          ...(patch.supplierId !== undefined ? { supplierId: patch.supplierId } : {}),
          ...(patch.orderedAt !== undefined ? { orderedAt: new Date(patch.orderedAt) } : {}),
          ...(patch.receivedAt !== undefined ? { receivedAt: new Date(patch.receivedAt) } : {}),
        },
      }),
    );
  }
}
