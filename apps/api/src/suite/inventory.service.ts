import { BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent, Order } from "@ordr/domain";
import type { EventBus, OrderRepository, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";
import { SuiteService } from "./suite.service";
import { type InventoryRepository, type MovementType, type PurchaseLine, type PurchaseOrder, type RecipeLine, type RecipeScope, type StockItem, type StockItemInput, type StockMovement, type Supplier, tenantModules } from "./types";

export type StockStatus = "in_stock" | "low" | "out";

export interface StockRow extends StockItem {
  /** In stock units (bags, litres, pieces), rounded for display. */
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

export interface MovementView extends StockMovement {
  itemName: string;
  unitLabel: string;
  /** Signed, in stock units. */
  units: number;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const CANCELLED = new Set(["cancelled", "rejected"]);

/** What one order uses up, in base units per stock item, from the recipes of its lines. */
export function usageOf(order: Pick<Order, "items" | "fulfillmentType">, recipes: RecipeLine[]): Map<string, number> {
  const dineIn = order.fulfillmentType === "dine_in";
  const applies = (scope: RecipeScope) => scope === "all" || (scope === "dine_in" ? dineIn : !dineIn);
  const out = new Map<string, number>();
  for (const line of order.items) {
    const chosen = new Set(line.modifiers.map((m) => m.optionId));
    for (const r of recipes) {
      if (r.offeringId !== line.offeringId || !applies(r.appliesTo)) continue;
      if (r.modifierOptionId && !chosen.has(r.modifierOptionId)) continue;
      out.set(r.stockItemId, (out.get(r.stockItemId) ?? 0) + r.quantity * line.quantity);
    }
  }
  return out;
}

/**
 * Stock for a restaurant: everything it can run out of, cups included. Every change is a ledger
 * row; the level is the sum. Selling deducts by recipe when an order is placed and gives it back
 * if the order is cancelled.
 */
@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(TOKENS.InventoryRepository) private readonly repo: InventoryRepository,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe("order.placed", (event) => this.onOrderPlaced(event));
    this.bus.subscribe("order.status_changed", (event) => this.onOrderStatusChanged(event));
  }

  // -- deduction ------------------------------------------------------------

  async onOrderPlaced(event: DomainEvent): Promise<void> {
    const order = await this.deductible(event);
    if (!order) return;
    // The event can be delivered twice (outbox retry): one set of sale rows per order, ever.
    const already = await this.repo.listMovements(order.tenantId, { refType: "order", refId: order.id, types: ["sale"], limit: 1 });
    if (already.length > 0) return;
    const usage = usageOf(order, await this.repo.recipes(order.tenantId, [...new Set(order.items.map((i) => i.offeringId))]));
    if (usage.size === 0) return;
    await this.repo.move([...usage.entries()].map(([stockItemId, quantity]) => ({ tenantId: order.tenantId, branchId: order.branchId!, stockItemId, type: "sale" as const, quantity: -quantity, refType: "order", refId: order.id, note: `Order #${order.number}` })));
    this.logger.log(`order #${order.number}: deducted ${usage.size} stock item(s)`);
  }

  async onOrderStatusChanged(event: DomainEvent): Promise<void> {
    const to = (event.payload as { to?: string } | undefined)?.to;
    if (!to || !CANCELLED.has(to)) return;
    const order = await this.deductible(event);
    if (!order) return;
    const rows = await this.repo.listMovements(order.tenantId, { refType: "order", refId: order.id, types: ["sale", "sale_reversal"] });
    if (rows.some((m) => m.type === "sale_reversal")) return;
    const sales = rows.filter((m) => m.type === "sale");
    if (sales.length === 0) return;
    await this.repo.move(sales.map((m) => ({ tenantId: m.tenantId, branchId: m.branchId, stockItemId: m.stockItemId, type: "sale_reversal" as const, quantity: -m.quantity, refType: "order", refId: order.id, note: `Order #${order.number} ${to}` })));
    this.logger.log(`order #${order.number} ${to}: returned ${sales.length} stock item(s)`);
  }

  /** The order behind an event, when its restaurant keeps stock and the order belongs to a branch. */
  private async deductible(event: DomainEvent): Promise<Order | null> {
    if (event.subject.kind !== "order") return null;
    const tenant = await this.tenants.findById(event.tenantId);
    if (!tenant || !tenantModules(tenant.settings).includes("inventory")) return null;
    const order = await this.orders.findById(event.tenantId, event.subject.id);
    return order && order.kind === "order" && order.branchId ? order : null;
  }

  // -- reads ----------------------------------------------------------------

  async overview(tenantId: string, branchId?: string): Promise<InventoryOverview> {
    const view = await this.suite.view(tenantId);
    const branch = await this.suite.branch(tenantId, branchId);
    const [items, levels] = await Promise.all([this.repo.listItems(tenantId, { includeInactive: true }), this.repo.levels(tenantId, branch.id)]);
    const rows = items.map((item) => this.row(item, levels.get(item.id) ?? 0));
    const active = rows.filter((r) => r.isActive);
    return {
      branch: { id: branch.id, name: branch.name },
      items: rows,
      categories: [...new Set(active.map((r) => r.category).filter((c): c is string => !!c))].sort(),
      totals: { items: active.length, valueMinor: active.reduce((n, r) => n + Math.max(0, r.valueMinor), 0), low: active.filter((r) => r.status === "low").length, out: active.filter((r) => r.status === "out").length },
      currency: view.currency,
    };
  }

  private row(item: StockItem, onHandBase: number): StockRow {
    const onHand = round(onHandBase / (item.unitSize || 1));
    const status: StockStatus = onHand <= 0 ? "out" : onHand <= item.reorderLevel ? "low" : "in_stock";
    return { ...item, onHand, status, valueMinor: Math.round(onHand * item.costMinor) };
  }

  async movements(tenantId: string, opts: { branchId?: string; stockItemId?: string; types?: MovementType[]; from?: Date; to?: Date; limit?: number }): Promise<MovementView[]> {
    const branch = await this.suite.branch(tenantId, opts.branchId);
    const [rows, items] = await Promise.all([this.repo.listMovements(tenantId, { ...opts, branchId: branch.id, limit: opts.limit ?? 200 }), this.repo.listItems(tenantId, { includeInactive: true })]);
    const byId = new Map(items.map((i) => [i.id, i]));
    return rows.map((m) => {
      const item = byId.get(m.stockItemId);
      return { ...m, itemName: item?.name ?? "Removed item", unitLabel: item?.unitLabel ?? "", units: round(m.quantity / (item?.unitSize || 1), 3) };
    });
  }

  // -- items ----------------------------------------------------------------

  async createItem(tenantId: string, input: StockItemInput & { openingStock?: number; branchId?: string }, actor?: string): Promise<StockRow> {
    const { openingStock, branchId, ...rest } = input;
    const item = await this.repo.createItem(tenantId, rest);
    let onHand = 0;
    if (openingStock && openingStock > 0) {
      const branch = await this.suite.branch(tenantId, branchId);
      onHand = openingStock * item.unitSize;
      await this.repo.move([{ tenantId, branchId: branch.id, stockItemId: item.id, type: "count", quantity: onHand, unitCostMinor: item.costMinor, note: "Opening stock", createdBy: actor }]);
    }
    return this.row(item, onHand);
  }

  async updateItem(tenantId: string, id: string, patch: Partial<StockItemInput>): Promise<StockItem> {
    const updated = await this.repo.updateItem(tenantId, id, patch);
    if (!updated) throw new NotFoundException("stock item not found");
    return updated;
  }

  /**
   * A manual change, in stock units: `adjustment` adds or removes, `wastage` removes, `count`
   * sets the level to what was counted (the ledger records the difference).
   */
  async adjust(tenantId: string, input: { branchId?: string; stockItemId: string; type: "adjustment" | "wastage" | "count"; quantity: number; note?: string }, actor?: string): Promise<StockRow> {
    const branch = await this.suite.branch(tenantId, input.branchId);
    const item = await this.repo.getItem(tenantId, input.stockItemId);
    if (!item) throw new NotFoundException("stock item not found");
    if (!Number.isFinite(input.quantity)) throw new BadRequestException("quantity must be a number");
    const current = (await this.repo.levels(tenantId, branch.id)).get(item.id) ?? 0;
    let delta: number;
    if (input.type === "count") {
      if (input.quantity < 0) throw new BadRequestException("a count cannot be negative");
      delta = input.quantity * item.unitSize - current;
    } else if (input.type === "wastage") {
      if (input.quantity <= 0) throw new BadRequestException("wastage must be more than zero");
      delta = -input.quantity * item.unitSize;
    } else {
      if (input.quantity === 0) throw new BadRequestException("an adjustment of zero changes nothing");
      delta = input.quantity * item.unitSize;
    }
    if (delta !== 0) await this.repo.move([{ tenantId, branchId: branch.id, stockItemId: item.id, type: input.type, quantity: delta, unitCostMinor: item.costMinor, note: input.note?.trim().slice(0, 200) || undefined, createdBy: actor }]);
    return this.row(item, current + delta);
  }

  // -- recipes --------------------------------------------------------------

  recipes(tenantId: string): Promise<RecipeLine[]> {
    return this.repo.recipes(tenantId);
  }

  async setRecipe(tenantId: string, offeringId: string, lines: Array<{ stockItemId: string; quantity: number; modifierOptionId?: string; appliesTo?: RecipeScope }>): Promise<RecipeLine[]> {
    const known = new Set((await this.repo.listItems(tenantId, { includeInactive: true })).map((i) => i.id));
    for (const l of lines) {
      if (!known.has(l.stockItemId)) throw new BadRequestException("a recipe line names a stock item that does not exist");
      if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new BadRequestException("recipe quantities must be more than zero");
    }
    return this.repo.setRecipe(tenantId, offeringId, lines.map((l) => ({ stockItemId: l.stockItemId, quantity: l.quantity, modifierOptionId: l.modifierOptionId || undefined, appliesTo: l.appliesTo ?? "all" })));
  }

  // -- suppliers and purchasing ----------------------------------------------

  suppliers(tenantId: string): Promise<Supplier[]> {
    return this.repo.listSuppliers(tenantId);
  }

  createSupplier(tenantId: string, input: { name: string; phone?: string; email?: string; notes?: string; leadDays?: number }): Promise<Supplier> {
    return this.repo.createSupplier(tenantId, input);
  }

  async updateSupplier(tenantId: string, id: string, patch: Partial<Omit<Supplier, "id" | "tenantId">>): Promise<Supplier> {
    const updated = await this.repo.updateSupplier(tenantId, id, patch);
    if (!updated) throw new NotFoundException("supplier not found");
    return updated;
  }

  async purchases(tenantId: string, branchId?: string): Promise<Array<PurchaseOrder & { supplierName?: string; lineNames: string[] }>> {
    const branch = await this.suite.branch(tenantId, branchId);
    const [rows, suppliers, items] = await Promise.all([this.repo.listPurchases(tenantId, { branchId: branch.id }), this.repo.listSuppliers(tenantId), this.repo.listItems(tenantId, { includeInactive: true })]);
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    const itemNames = new Map(items.map((i) => [i.id, i.name]));
    return rows.map((p) => ({ ...p, supplierName: p.supplierId ? names.get(p.supplierId) : undefined, lineNames: p.lines.map((l) => itemNames.get(l.stockItemId) ?? "Removed item") }));
  }

  async createPurchase(tenantId: string, input: { branchId?: string; supplierId?: string; lines: PurchaseLine[]; notes?: string; status?: "draft" | "ordered" }, actor?: string): Promise<PurchaseOrder> {
    const branch = await this.suite.branch(tenantId, input.branchId);
    const lines = await this.checkedLines(tenantId, input.lines);
    if (input.supplierId && !(await this.repo.listSuppliers(tenantId)).some((s) => s.id === input.supplierId)) throw new BadRequestException("supplier not found");
    const status = input.status ?? "ordered";
    return this.repo.createPurchase({ tenantId, branchId: branch.id, supplierId: input.supplierId, status, lines, notes: input.notes?.trim().slice(0, 300) || undefined, totalMinor: lines.reduce((n, l) => n + Math.round(l.quantity * l.unitCostMinor), 0), orderedAt: status === "ordered" ? new Date().toISOString() : undefined, createdBy: actor });
  }

  /** Books a purchase order into stock: one purchase row per line, and the item's cost becomes the price just paid. */
  async receivePurchase(tenantId: string, id: string, actor?: string): Promise<PurchaseOrder> {
    const po = await this.repo.getPurchase(tenantId, id);
    if (!po) throw new NotFoundException("purchase order not found");
    if (po.status === "received") throw new BadRequestException("this purchase order was already received");
    if (po.status === "cancelled") throw new BadRequestException("this purchase order was cancelled");
    const items = new Map((await this.repo.listItems(tenantId, { includeInactive: true })).map((i) => [i.id, i]));
    // Mark it received first: if the stock write then fails, a retry is refused instead of doubling the stock.
    const updated = await this.repo.updatePurchase(tenantId, id, { status: "received", receivedAt: new Date().toISOString() });
    await this.repo.move(po.lines.filter((l) => items.has(l.stockItemId)).map((l) => ({ tenantId, branchId: po.branchId, stockItemId: l.stockItemId, type: "purchase" as const, quantity: l.quantity * items.get(l.stockItemId)!.unitSize, unitCostMinor: l.unitCostMinor, refType: "purchase", refId: po.id, note: `PO-${po.number}`, createdBy: actor })));
    for (const l of po.lines) if (l.unitCostMinor > 0 && items.has(l.stockItemId)) await this.repo.updateItem(tenantId, l.stockItemId, { costMinor: l.unitCostMinor });
    return updated!;
  }

  async cancelPurchase(tenantId: string, id: string): Promise<PurchaseOrder> {
    const po = await this.repo.getPurchase(tenantId, id);
    if (!po) throw new NotFoundException("purchase order not found");
    if (po.status === "received") throw new BadRequestException("a received purchase order cannot be cancelled");
    return (await this.repo.updatePurchase(tenantId, id, { status: "cancelled" }))!;
  }

  private async checkedLines(tenantId: string, lines: PurchaseLine[]): Promise<PurchaseLine[]> {
    if (!Array.isArray(lines) || lines.length === 0) throw new BadRequestException("a purchase order needs at least one line");
    const known = new Set((await this.repo.listItems(tenantId, { includeInactive: true })).map((i) => i.id));
    return lines.map((l) => {
      if (!known.has(l.stockItemId)) throw new BadRequestException("a line names a stock item that does not exist");
      if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new BadRequestException("quantities must be more than zero");
      if (!Number.isInteger(l.unitCostMinor) || l.unitCostMinor < 0) throw new BadRequestException("unit cost must be zero or more");
      return { stockItemId: l.stockItemId, quantity: l.quantity, unitCostMinor: l.unitCostMinor };
    });
  }

  /** Usage, wastage and purchases per item over a period, in stock units and value. */
  async report(tenantId: string, opts: { branchId?: string; from: Date; to: Date }): Promise<{ rows: Array<{ stockItemId: string; name: string; unitLabel: string; used: number; wasted: number; purchased: number; usedValueMinor: number; wastedValueMinor: number }>; totals: { usedValueMinor: number; wastedValueMinor: number; purchasedValueMinor: number } }> {
    const branch = await this.suite.branch(tenantId, opts.branchId);
    const [moves, items] = await Promise.all([this.repo.listMovements(tenantId, { branchId: branch.id, from: opts.from, to: opts.to, limit: 5000 }), this.repo.listItems(tenantId, { includeInactive: true })]);
    const acc = new Map<string, { used: number; wasted: number; purchased: number; purchasedValue: number }>();
    for (const m of moves) {
      const a = acc.get(m.stockItemId) ?? { used: 0, wasted: 0, purchased: 0, purchasedValue: 0 };
      if (m.type === "sale" || m.type === "sale_reversal") a.used += -m.quantity;
      if (m.type === "wastage") a.wasted += -m.quantity;
      if (m.type === "purchase") a.purchased += m.quantity;
      acc.set(m.stockItemId, a);
    }
    const rows = items
      .filter((i) => acc.has(i.id))
      .map((i) => {
        const a = acc.get(i.id)!;
        const units = (base: number) => round(base / (i.unitSize || 1), 3);
        return { stockItemId: i.id, name: i.name, unitLabel: i.unitLabel, used: units(a.used), wasted: units(a.wasted), purchased: units(a.purchased), usedValueMinor: Math.round(units(a.used) * i.costMinor), wastedValueMinor: Math.round(units(a.wasted) * i.costMinor), purchasedValueMinor: Math.round(units(a.purchased) * i.costMinor) };
      })
      .sort((a, b) => b.usedValueMinor - a.usedValueMinor);
    return { rows: rows.map(({ purchasedValueMinor: _p, ...r }) => r), totals: { usedValueMinor: rows.reduce((n, r) => n + r.usedValueMinor, 0), wastedValueMinor: rows.reduce((n, r) => n + r.wastedValueMinor, 0), purchasedValueMinor: rows.reduce((n, r) => n + r.purchasedValueMinor, 0) } };
  }
}
