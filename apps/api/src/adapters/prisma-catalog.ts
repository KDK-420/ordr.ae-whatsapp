import type { Category, DeliveryLocation, LocalizedText, ModifierGroup, Offering, Order, OrderItem, OrderKind, OrderSource, PaymentStatus } from "@ordr/domain";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CatalogRepository, CreateOrderInput, OrderRepository } from "../ports";

type OfferingRow = Prisma.OfferingGetPayload<{ include: { modifierGroups: { include: { options: true } } } }>;
type OrderRow = Prisma.OrderGetPayload<{ include: { items: true } }>;

const asText = (v: Prisma.JsonValue | null): LocalizedText | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as LocalizedText) : undefined);

function toOffering(row: OfferingRow): Offering {
  const groups: ModifierGroup[] = row.modifierGroups
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => ({
      id: g.id,
      name: asText(g.name) ?? {},
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sortOrder: g.sortOrder,
      options: g.options
        .filter((o) => o.isActive)
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
    return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, name: asText(r.name) ?? {}, sortOrder: r.sortOrder, isActive: r.isActive }));
  }

  async listOfferings(tenantId: string, categoryId: string): Promise<Offering[]> {
    const rows = await this.prisma.offering.findMany({
      where: { tenantId, categoryId, isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { modifierGroups: { include: { options: true } } },
    });
    return rows.map(toOffering);
  }

  async getOffering(tenantId: string, offeringId: string): Promise<Offering | null> {
    const row = await this.prisma.offering.findFirst({
      where: { tenantId, id: offeringId },
      include: { modifierGroups: { include: { options: true } } },
    });
    return row ? toOffering(row) : null;
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

  async create(input: CreateOrderInput): Promise<Order> {
    const row = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({ where: { id: input.tenantId }, data: { orderSeq: { increment: 1 } }, select: { orderSeq: true } });
      return tx.order.create({
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
    });
    return toOrder(row);
  }

  async findById(tenantId: string, orderId: string): Promise<Order | null> {
    const row = await this.prisma.order.findFirst({ where: { tenantId, id: orderId }, include: { items: true } });
    return row ? toOrder(row) : null;
  }

  async latestForCustomer(tenantId: string, customerId: string): Promise<Order | null> {
    const row = await this.prisma.order.findFirst({ where: { tenantId, customerId }, orderBy: { createdAt: "desc" }, include: { items: true } });
    return row ? toOrder(row) : null;
  }

  async updateStatus(tenantId: string, orderId: string, status: string, event: { type: string; payload?: unknown }): Promise<Order> {
    const row = await this.prisma.order.update({
      where: { id: orderId, tenantId },
      data: { status, events: { create: { tenantId, type: event.type, payload: (event.payload ?? {}) as Prisma.InputJsonValue } } },
      include: { items: true },
    });
    return toOrder(row);
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
