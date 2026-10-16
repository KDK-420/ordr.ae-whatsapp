import type { Category, DeliveryLocation, LocalizedText, ModifierGroup, Offering, Order, OrderItem, OrderKind, OrderSource, PaymentStatus } from "@ordr/domain";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CatalogRepository, CategoryInput, CreateOrderInput, ModifierGroupInput, OfferingInput, OrderRepository, OutboxFactory } from "../ports";
import { toOutboxRow } from "./outbox";

const OFFERING_INCLUDE = { modifierGroups: { include: { options: true } } } as const;

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

type OfferingRow = Prisma.OfferingGetPayload<{ include: { modifierGroups: { include: { options: true } } } }>;
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
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    modifierGroups: groups,
  };
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
        isActive: input.isActive ?? true,
        modifierGroups: { create: groupsCreate(tenantId, input.modifierGroups ?? []) },
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
          ...(patch.modifierGroups ? { modifierGroups: { create: groupsCreate(tenantId, patch.modifierGroups) } } : {}),
        },
        include: OFFERING_INCLUDE,
      });
    });
    return toOffering(row, true);
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
          items: {
            create: input.items.map((i) => ({
              offeringId: i.offeringId || null,
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
