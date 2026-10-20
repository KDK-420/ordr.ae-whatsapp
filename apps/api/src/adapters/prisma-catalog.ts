import {
  type Category,
  type DeliveryLocation,
  type LocalizedText,
  type ModifierGroup,
  type Offering,
  type Order,
  type OrderItem,
  type OrderKind,
  type OrderSource,
  overlaps,
  type PaymentStatus,
  type Resource,
  SlotTakenError,
  type WeeklyHours,
} from "@ordr/domain";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CatalogRepository,
  CategoryInput,
  CreateBookingInput,
  CreateOrderInput,
  ModifierGroupInput,
  OfferingInput,
  OrderRepository,
  OutboxFactory,
  ResourceInput,
  ResourceRepository,
  RescheduleInput,
  StockLine,
  StockShortage,
  VariantInput,
} from "../ports";
import { toOutboxRow } from "./outbox";

type ResourceRow = Prisma.ResourceGetPayload<Record<string, never>>;

const toResource = (r: ResourceRow): Resource => ({
  id: r.id,
  tenantId: r.tenantId,
  type: r.type === "room" || r.type === "asset" ? r.type : "staff",
  name: (r.name as LocalizedText) ?? {},
  hours: (r.hours as WeeklyHours) ?? {},
  skills: Array.isArray(r.skills) ? (r.skills as string[]) : [],
  sortOrder: r.sortOrder,
  isActive: r.isActive,
});

export class PrismaResourceRepository implements ResourceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<Resource[]> {
    const rows = await this.prisma.resource.findMany({ where: { tenantId, ...(opts.includeInactive ? {} : { isActive: true }) }, orderBy: { sortOrder: "asc" } });
    return rows.map(toResource);
  }

  async get(tenantId: string, resourceId: string): Promise<Resource | null> {
    const r = await this.prisma.resource.findFirst({ where: { tenantId, id: resourceId } });
    return r ? toResource(r) : null;
  }

  async create(tenantId: string, input: ResourceInput): Promise<Resource> {
    const sortOrder = input.sortOrder ?? (await this.prisma.resource.count({ where: { tenantId } }));
    const r = await this.prisma.resource.create({
      data: {
        tenantId,
        type: input.type ?? "staff",
        name: input.name as Prisma.InputJsonValue,
        hours: (input.hours ?? {}) as Prisma.InputJsonValue,
        skills: (input.skills ?? []) as Prisma.InputJsonValue,
        sortOrder,
        isActive: input.isActive ?? true,
      },
    });
    return toResource(r);
  }

  async update(tenantId: string, resourceId: string, patch: Partial<ResourceInput>): Promise<Resource | null> {
    const existing = await this.prisma.resource.findFirst({ where: { tenantId, id: resourceId } });
    if (!existing) return null;
    const r = await this.prisma.resource.update({
      where: { id: resourceId },
      data: {
        ...(patch.name ? { name: patch.name as Prisma.InputJsonValue } : {}),
        ...(patch.type ? { type: patch.type } : {}),
        ...(patch.hours ? { hours: patch.hours as Prisma.InputJsonValue } : {}),
        ...(patch.skills ? { skills: patch.skills as Prisma.InputJsonValue } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    return toResource(r);
  }
}

const OFFERING_INCLUDE = { modifierGroups: { include: { options: true } }, variants: true } as const;

const toCategory = (r: { id: string; tenantId: string; name: Prisma.JsonValue; sortOrder: number; isActive: boolean }): Category => ({
  id: r.id,
  tenantId: r.tenantId,
  name: asText(r.name) ?? {},
  sortOrder: r.sortOrder,
  isActive: r.isActive,
});

function groupsCreate(tenantId: string, groups: ModifierGroupInput[]): Prisma.ModifierGroupCreateWithoutOfferingInput[] {
  return groups.map((g, gi) => ({
    tenantId,
    name: g.name as Prisma.InputJsonValue,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    sortOrder: g.sortOrder ?? gi,
    options: {
      create: g.options.map((o, oi) => ({
        tenantId,
        name: o.name as Prisma.InputJsonValue,
        priceDeltaMinor: o.priceDeltaMinor,
        sortOrder: o.sortOrder ?? oi,
        isActive: o.isActive ?? true,
      })),
    },
  }));
}

type OfferingRow = Prisma.OfferingGetPayload<{ include: { modifierGroups: { include: { options: true } }; variants: true } }>;
type OrderRow = Prisma.OrderGetPayload<{ include: { items: true } }>;

const asText = (v: Prisma.JsonValue | null): LocalizedText | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as LocalizedText) : undefined);

function toOffering(row: OfferingRow, includeInactiveOptions = false): Offering {
  const groups: ModifierGroup[] = row.modifierGroups
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => ({
      id: g.id,
      name: asText(g.name) ?? {},
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sortOrder: g.sortOrder,
      options: g.options
        .filter((o) => includeInactiveOptions || o.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((o) => ({ id: o.id, name: asText(o.name) ?? {}, priceDeltaMinor: o.priceDeltaMinor, sortOrder: o.sortOrder, isActive: o.isActive })),
    }));
  return {
    id: row.id,
    tenantId: row.tenantId,
    categoryId: row.categoryId ?? undefined,
    type: row.type === "service" ? "service" : "product",
    name: asText(row.name) ?? {},
    description: asText(row.description),
    priceMinor: row.priceMinor,
    currency: row.currency,
    durationMinutes: row.durationMinutes ?? undefined,
    imageUrl: row.imageUrl ?? undefined,
    stock: row.stock ?? undefined,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    modifierGroups: groups,
    variants: row.variants
      .filter((v) => includeInactiveOptions || v.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => ({ id: v.id, name: asText(v.name) ?? {}, sku: v.sku ?? undefined, priceMinor: v.priceMinor ?? undefined, stock: v.stock ?? undefined, sortOrder: v.sortOrder, isActive: v.isActive })),
  };
}

function variantsCreate(tenantId: string, variants: VariantInput[]): Prisma.ProductVariantCreateWithoutOfferingInput[] {
  return variants.map((v, i) => ({
    ...(v.id ? { id: v.id } : {}),
    tenantId,
    name: v.name as Prisma.InputJsonValue,
    sku: v.sku ?? null,
    priceMinor: v.priceMinor ?? null,
    stock: v.stock ?? null,
    sortOrder: v.sortOrder ?? i,
    isActive: v.isActive ?? true,
  }));
}

export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listCategories(tenantId: string): Promise<Category[]> {
    const rows = await this.prisma.category.findMany({ where: { tenantId, isActive: true }, orderBy: { sortOrder: "asc" } });
    return rows.map(toCategory);
  }

  async listOfferings(tenantId: string, categoryId: string): Promise<Offering[]> {
    const rows = await this.prisma.offering.findMany({ where: { tenantId, categoryId, isActive: true }, orderBy: { sortOrder: "asc" }, include: OFFERING_INCLUDE });
    return rows.map((r) => toOffering(r));
  }

  async getOffering(tenantId: string, offeringId: string): Promise<Offering | null> {
    const row = await this.prisma.offering.findFirst({ where: { tenantId, id: offeringId }, include: OFFERING_INCLUDE });
    return row ? toOffering(row) : null;
  }

  async listAllCategories(tenantId: string): Promise<Category[]> {
    const rows = await this.prisma.category.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } });
    return rows.map(toCategory);
  }

  async listAllOfferings(tenantId: string): Promise<Offering[]> {
    const rows = await this.prisma.offering.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" }, include: OFFERING_INCLUDE });
    return rows.map((r) => toOffering(r, true));
  }

  async createCategory(tenantId: string, input: CategoryInput): Promise<Category> {
    const sortOrder = input.sortOrder ?? (await this.prisma.category.count({ where: { tenantId } }));
    const row = await this.prisma.category.create({ data: { tenantId, name: input.name as Prisma.InputJsonValue, sortOrder, isActive: input.isActive ?? true } });
    return toCategory(row);
  }

  async updateCategory(tenantId: string, categoryId: string, patch: Partial<CategoryInput>): Promise<Category | null> {
    const existing = await this.prisma.category.findFirst({ where: { tenantId, id: categoryId } });
    if (!existing) return null;
    const row = await this.prisma.category.update({
      where: { id: categoryId },
      data: {
        ...(patch.name ? { name: patch.name as Prisma.InputJsonValue } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    return toCategory(row);
  }

  async createOffering(tenantId: string, input: OfferingInput): Promise<Offering> {
    const sortOrder = input.sortOrder ?? (await this.prisma.offering.count({ where: { tenantId } }));
    const row = await this.prisma.offering.create({
      data: {
        tenantId,
        categoryId: input.categoryId ?? null,
        type: input.type ?? "product",
        name: input.name as Prisma.InputJsonValue,
        description: input.description ? (input.description as Prisma.InputJsonValue) : Prisma.JsonNull,
        priceMinor: input.priceMinor,
        currency: input.currency ?? "AED",
        durationMinutes: input.durationMinutes ?? null,
        imageUrl: input.imageUrl ?? null,
        sortOrder,
        stock: input.stock ?? null,
        isActive: input.isActive ?? true,
        modifierGroups: { create: groupsCreate(tenantId, input.modifierGroups ?? []) },
        variants: { create: variantsCreate(tenantId, input.variants ?? []) },
      },
      include: OFFERING_INCLUDE,
    });
    return toOffering(row, true);
  }

  async updateOffering(tenantId: string, offeringId: string, patch: Partial<OfferingInput>): Promise<Offering | null> {
    const existing = await this.prisma.offering.findFirst({ where: { tenantId, id: offeringId } });
    if (!existing) return null;
    const row = await this.prisma.$transaction(async (tx) => {
      if (patch.modifierGroups) await tx.modifierGroup.deleteMany({ where: { offeringId } });
      if (patch.variants) {
        // Keep rows whose id the patch names (stock survives an edit); replace the rest.
        const keep = patch.variants.map((v) => v.id).filter((id): id is string => !!id);
        await tx.productVariant.deleteMany({ where: { offeringId, id: { notIn: keep } } });
        for (const [i, v] of patch.variants.entries()) {
          const data = { name: v.name as Prisma.InputJsonValue, sku: v.sku ?? null, priceMinor: v.priceMinor ?? null, sortOrder: v.sortOrder ?? i, isActive: v.isActive ?? true, ...(v.stock !== undefined ? { stock: v.stock } : {}) };
          if (v.id && (await tx.productVariant.findFirst({ where: { id: v.id, offeringId } }))) await tx.productVariant.update({ where: { id: v.id }, data });
          else await tx.productVariant.create({ data: { ...data, ...(v.id ? { id: v.id } : {}), tenantId, offeringId, stock: v.stock ?? null } });
        }
      }
      return tx.offering.update({
        where: { id: offeringId },
        data: {
          ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
          ...(patch.type ? { type: patch.type } : {}),
          ...(patch.name ? { name: patch.name as Prisma.InputJsonValue } : {}),
          ...(patch.description !== undefined ? { description: patch.description ? (patch.description as Prisma.InputJsonValue) : Prisma.JsonNull } : {}),
          ...(patch.priceMinor !== undefined ? { priceMinor: patch.priceMinor } : {}),
          ...(patch.currency ? { currency: patch.currency } : {}),
          ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
          ...(patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl } : {}),
          ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
          ...(patch.stock !== undefined ? { stock: patch.stock } : {}),
          ...(patch.modifierGroups ? { modifierGroups: { create: groupsCreate(tenantId, patch.modifierGroups) } } : {}),
        },
        include: OFFERING_INCLUDE,
      });
    });
    return toOffering(row, true);
  }

  /** All lines or none: conditional decrements inside one transaction; a zero-row update means a shortage. */
  async reserveStock(tenantId: string, lines: StockLine[]): Promise<{ ok: true } | { ok: false; shortages: StockShortage[] }> {
    return this.prisma.$transaction(async (tx) => {
      const shortages: StockShortage[] = [];
      for (const line of lines) {
        if (line.variantId) {
          const v = await tx.productVariant.findFirst({ where: { id: line.variantId, tenantId, offeringId: line.offeringId } });
          if (!v) {
            shortages.push({ ...line, available: 0 });
            continue;
          }
          if (v.stock === null) continue;
          const res = await tx.productVariant.updateMany({ where: { id: v.id, stock: { gte: line.quantity } }, data: { stock: { decrement: line.quantity } } });
          if (res.count === 0) shortages.push({ ...line, available: v.stock });
        } else {
          const o = await tx.offering.findFirst({ where: { id: line.offeringId, tenantId } });
          if (!o) {
            shortages.push({ ...line, available: 0 });
            continue;
          }
          if (o.stock === null) continue;
          const res = await tx.offering.updateMany({ where: { id: o.id, stock: { gte: line.quantity } }, data: { stock: { decrement: line.quantity } } });
          if (res.count === 0) shortages.push({ ...line, available: o.stock });
        }
      }
      if (shortages.length) throw new StockShortageSignal(shortages);
      return { ok: true as const };
    }).catch((err) => {
      if (err instanceof StockShortageSignal) return { ok: false as const, shortages: err.shortages };
      throw err;
    });
  }

  async releaseStock(tenantId: string, lines: StockLine[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        if (line.variantId) await tx.productVariant.updateMany({ where: { id: line.variantId, tenantId, stock: { not: null } }, data: { stock: { increment: line.quantity } } });
        else await tx.offering.updateMany({ where: { id: line.offeringId, tenantId, stock: { not: null } }, data: { stock: { increment: line.quantity } } });
      }
    });
  }
}

/** Rolls the reservation transaction back and carries the shortages out. */
class StockShortageSignal extends Error {
  constructor(public readonly shortages: StockShortage[]) {
    super("stock shortage");
  }
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    tenantId: row.tenantId,
    number: row.number,
    kind: row.kind as OrderKind,
    status: row.status,
    fulfillmentType: row.fulfillmentType,
    source: row.source as OrderSource,
    customerId: row.customerId,
    conversationId: row.conversationId ?? undefined,
    items: row.items.map(
      (i): OrderItem => ({
        id: i.id,
        offeringId: i.offeringId ?? "",
        variantId: i.variantId ?? undefined,
        variantTitle: i.variantTitle ?? undefined,
        title: i.title,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        modifiers: (i.modifiers as unknown as OrderItem["modifiers"]) ?? [],
        lineTotalMinor: i.lineTotalMinor,
        notes: i.notes ?? undefined,
      }),
    ),
    currency: row.currency,
    subtotalMinor: row.subtotalMinor,
    deliveryFeeMinor: row.deliveryFeeMinor,
    vatMinor: row.vatMinor,
    totalMinor: row.totalMinor,
    paymentStatus: row.paymentStatus as PaymentStatus,
    paymentMethod: row.paymentMethod ?? undefined,
    deliveryLocation: (row.deliveryLocation as unknown as DeliveryLocation | null) ?? undefined,
    notes: row.notes ?? undefined,
    scheduledAt: row.scheduledAt?.toISOString(),
    resourceId: row.resourceId ?? undefined,
    durationMinutes: row.durationMinutes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateOrderInput, outbox?: OutboxFactory): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({ where: { id: input.tenantId }, data: { orderSeq: { increment: 1 } }, select: { orderSeq: true } });
      const row = await tx.order.create({
        data: {
          tenantId: input.tenantId,
          number: tenant.orderSeq,
          kind: input.kind,
          status: input.initialStatus,
          fulfillmentType: input.fulfillmentType,
          source: input.source,
          customerId: input.customerId,
          conversationId: input.conversationId,
          currency: input.currency,
          subtotalMinor: input.subtotalMinor,
          deliveryFeeMinor: input.deliveryFeeMinor,
          vatMinor: input.vatMinor,
          totalMinor: input.totalMinor,
          paymentStatus: input.paymentStatus,
          paymentMethod: input.paymentMethod,
          deliveryLocation: input.deliveryLocation ? (input.deliveryLocation as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          notes: input.notes,
          scheduledAt: input.scheduledAt,
          resourceId: input.resourceId,
          durationMinutes: input.durationMinutes,
          items: {
            create: input.items.map((i) => ({
              offeringId: i.offeringId || null,
              variantId: i.variantId ?? null,
              variantTitle: i.variantTitle ?? null,
              title: i.title,
              quantity: i.quantity,
              unitPriceMinor: i.unitPriceMinor,
              modifiers: i.modifiers as unknown as Prisma.InputJsonValue,
              lineTotalMinor: i.lineTotalMinor,
              notes: i.notes,
            })),
          },
          events: { create: { tenantId: input.tenantId, type: "order.placed", payload: {} } },
        },
        include: { items: true },
      });
      const order = toOrder(row);
      if (outbox) await tx.outboxEvent.create({ data: toOutboxRow(outbox(order)) });
      return order;
    });
  }

  async findById(tenantId: string, orderId: string): Promise<Order | null> {
    const row = await this.prisma.order.findFirst({ where: { tenantId, id: orderId }, include: { items: true } });
    return row ? toOrder(row) : null;
  }

  async latestForCustomer(tenantId: string, customerId: string): Promise<Order | null> {
    const row = await this.prisma.order.findFirst({ where: { tenantId, customerId }, orderBy: { createdAt: "desc" }, include: { items: true } });
    return row ? toOrder(row) : null;
  }

  async updateStatus(tenantId: string, orderId: string, status: string, event: { type: string; payload?: unknown }, outbox?: OutboxFactory): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id: orderId, tenantId },
        data: { status, events: { create: { tenantId, type: event.type, payload: (event.payload ?? {}) as Prisma.InputJsonValue } } },
        include: { items: true },
      });
      const order = toOrder(row);
      if (outbox) await tx.outboxEvent.create({ data: toOutboxRow(outbox(order)) });
      return order;
    });
  }

  async listByStatus(tenantId: string, statuses: string[], limit = 50): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({ where: { tenantId, status: { in: statuses } }, orderBy: { createdAt: "asc" }, take: limit, include: { items: true } });
    return rows.map(toOrder);
  }

  async createBooking(input: CreateBookingInput, blockingStatuses: string[], outbox?: OutboxFactory): Promise<Order> {
    const start = input.scheduledAt;
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    return this.prisma.$transaction(async (tx) => {
      // Row lock on the resource serializes concurrent bookings for it; the overlap check below is then exact.
      await tx.$queryRaw`SELECT id FROM "Resource" WHERE id = ${input.resourceId} FOR UPDATE`;
      const candidates = await tx.order.findMany({
        where: {
          tenantId: input.tenantId,
          resourceId: input.resourceId,
          status: { in: blockingStatuses },
          scheduledAt: { gte: new Date(start.getTime() - 24 * 60 * 60_000), lt: end },
        },
        select: { scheduledAt: true, durationMinutes: true },
      });
      const clash = candidates.some((c) => c.scheduledAt && overlaps(start, end, c.scheduledAt, new Date(c.scheduledAt.getTime() + (c.durationMinutes ?? 0) * 60_000)));
      if (clash) throw new SlotTakenError();
      // Someone else's live hold on the slot counts as taken; the customer's own hold does not.
      const heldByOthers = await tx.bookingHold.count({ where: { tenantId: input.tenantId, resourceId: input.resourceId, status: "held", expiresAt: { gt: new Date() }, startAt: { lt: end }, endAt: { gt: start }, ...(input.holdId ? { id: { not: input.holdId } } : {}) } });
      if (heldByOthers > 0) throw new SlotTakenError();
      if (input.holdId) await tx.bookingHold.updateMany({ where: { id: input.holdId, tenantId: input.tenantId }, data: { status: "confirmed" } });
      const tenant = await tx.tenant.update({ where: { id: input.tenantId }, data: { orderSeq: { increment: 1 } }, select: { orderSeq: true } });
      const row = await tx.order.create({
        data: {
          tenantId: input.tenantId,
          number: tenant.orderSeq,
          kind: input.kind,
          status: input.initialStatus,
          fulfillmentType: input.fulfillmentType,
          source: input.source,
          customerId: input.customerId,
          conversationId: input.conversationId,
          currency: input.currency,
          subtotalMinor: input.subtotalMinor,
          deliveryFeeMinor: input.deliveryFeeMinor,
          vatMinor: input.vatMinor,
          totalMinor: input.totalMinor,
          paymentStatus: input.paymentStatus,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
          scheduledAt: start,
          resourceId: input.resourceId,
          durationMinutes: input.durationMinutes,
          items: {
            create: input.items.map((i) => ({
              offeringId: i.offeringId || null,
              variantId: i.variantId ?? null,
              variantTitle: i.variantTitle ?? null,
              title: i.title,
              quantity: i.quantity,
              unitPriceMinor: i.unitPriceMinor,
              modifiers: i.modifiers as unknown as Prisma.InputJsonValue,
              lineTotalMinor: i.lineTotalMinor,
              notes: i.notes,
            })),
          },
          events: { create: { tenantId: input.tenantId, type: "order.placed", payload: {} } },
        },
        include: { items: true },
      });
      const order = toOrder(row);
      if (outbox) await tx.outboxEvent.create({ data: toOutboxRow(outbox(order)) });
      return order;
    });
  }

  async reschedule(tenantId: string, orderId: string, input: RescheduleInput, blockingStatuses: string[], outbox?: OutboxFactory): Promise<Order> {
    const start = input.scheduledAt;
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Resource" WHERE id = ${input.resourceId} FOR UPDATE`;
      const candidates = await tx.order.findMany({
        where: { tenantId, resourceId: input.resourceId, status: { in: blockingStatuses }, id: { not: orderId }, scheduledAt: { gte: new Date(start.getTime() - 24 * 60 * 60_000), lt: end } },
        select: { scheduledAt: true, durationMinutes: true },
      });
      if (candidates.some((c) => c.scheduledAt && overlaps(start, end, c.scheduledAt, new Date(c.scheduledAt.getTime() + (c.durationMinutes ?? 0) * 60_000)))) throw new SlotTakenError();
      const heldByOthers = await tx.bookingHold.count({ where: { tenantId, resourceId: input.resourceId, status: "held", expiresAt: { gt: new Date() }, startAt: { lt: end }, endAt: { gt: start }, ...(input.holdId ? { id: { not: input.holdId } } : {}) } });
      if (heldByOthers > 0) throw new SlotTakenError();
      if (input.holdId) await tx.bookingHold.updateMany({ where: { id: input.holdId, tenantId }, data: { status: "confirmed" } });
      const row = await tx.order.update({
        where: { id: orderId },
        data: { scheduledAt: start, resourceId: input.resourceId, durationMinutes: input.durationMinutes, events: { create: { tenantId, type: "order.rescheduled", payload: { scheduledAt: start.toISOString(), resourceId: input.resourceId } } } },
        include: { items: true },
      });
      if (row.tenantId !== tenantId) throw new Error("order belongs to another tenant");
      const order = toOrder(row);
      if (outbox) await tx.outboxEvent.create({ data: toOutboxRow(outbox(order)) });
      return order;
    });
  }

  async updatePayment(tenantId: string, orderId: string, paymentStatus: PaymentStatus, status: string, event: { type: string; payload?: unknown }, outbox?: OutboxFactory): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({ where: { tenantId, id: orderId } });
      if (!existing) throw new Error(`order ${orderId} not found`);
      const row = await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus, status, events: { create: { tenantId, type: event.type, payload: (event.payload ?? {}) as Prisma.InputJsonValue } } },
        include: { items: true },
      });
      const order = toOrder(row);
      if (outbox) await tx.outboxEvent.create({ data: toOutboxRow(outbox(order)) });
      return order;
    });
  }

  async listBookings(tenantId: string, opts: { from: Date; to: Date; resourceId?: string; statuses?: string[] }): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        tenantId,
        scheduledAt: { gte: opts.from, lt: opts.to },
        ...(opts.resourceId ? { resourceId: opts.resourceId } : {}),
        ...(opts.statuses ? { status: { in: opts.statuses } } : {}),
      },
      orderBy: { scheduledAt: "asc" },
      include: { items: true },
    });
    return rows.map(toOrder);
  }

  async listRecent(tenantId: string, opts: { statuses?: string[]; since?: Date; limit?: number } = {}): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        tenantId,
        ...(opts.statuses ? { status: { in: opts.statuses } } : {}),
        ...(opts.since ? { updatedAt: { gte: opts.since } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { number: "desc" }],
      take: opts.limit ?? 100,
      include: { items: true },
    });
    return rows.map(toOrder);
  }
}
