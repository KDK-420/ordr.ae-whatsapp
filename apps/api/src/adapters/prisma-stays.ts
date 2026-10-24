import { freeUnits, type LocalizedText, type Order, type Property, SlotTakenError } from "@ordr/domain";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { BookingHoldRecord, CreateHoldInput, CreateStayInput, MediaAssetRecord, MediaRepository, OutboxFactory, PropertyInput, PropertyRepository, StayOccupancy, StayRepository } from "../ports";
import { toOutboxRow } from "./outbox";
import { orderItemsCreate, toOrder } from "./prisma-catalog";

type PropertyRow = Prisma.PropertyGetPayload<Record<string, never>>;

const strings = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const toProperty = (r: PropertyRow): Property => ({
  id: r.id,
  tenantId: r.tenantId,
  name: (r.name as LocalizedText) ?? {},
  description: r.description && typeof r.description === "object" && !Array.isArray(r.description) ? (r.description as LocalizedText) : undefined,
  address: r.address ?? undefined,
  mapsUrl: r.mapsUrl ?? undefined,
  phone: r.phone ?? undefined,
  checkInTime: r.checkInTime,
  checkOutTime: r.checkOutTime,
  amenities: strings(r.amenities),
  imageUrls: strings(r.imageUrls),
  sortOrder: r.sortOrder,
  isActive: r.isActive,
});

export class PrismaPropertyRepository implements PropertyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<Property[]> {
    const rows = await this.prisma.property.findMany({ where: { tenantId, ...(opts.includeInactive ? {} : { isActive: true }) }, orderBy: { sortOrder: "asc" } });
    return rows.map(toProperty);
  }

  async get(tenantId: string, propertyId: string): Promise<Property | null> {
    const r = await this.prisma.property.findFirst({ where: { tenantId, id: propertyId } });
    return r ? toProperty(r) : null;
  }

  async create(tenantId: string, input: PropertyInput): Promise<Property> {
    const sortOrder = input.sortOrder ?? (await this.prisma.property.count({ where: { tenantId } }));
    const r = await this.prisma.property.create({
      data: {
        tenantId,
        name: input.name as Prisma.InputJsonValue,
        description: input.description ? (input.description as Prisma.InputJsonValue) : Prisma.JsonNull,
        address: input.address ?? null,
        mapsUrl: input.mapsUrl ?? null,
        phone: input.phone ?? null,
        checkInTime: input.checkInTime ?? "15:00",
        checkOutTime: input.checkOutTime ?? "12:00",
        amenities: (input.amenities ?? []) as Prisma.InputJsonValue,
        imageUrls: (input.imageUrls ?? []) as Prisma.InputJsonValue,
        sortOrder,
        isActive: input.isActive ?? true,
      },
    });
    return toProperty(r);
  }

  async update(tenantId: string, propertyId: string, patch: Partial<PropertyInput>): Promise<Property | null> {
    const existing = await this.prisma.property.findFirst({ where: { tenantId, id: propertyId } });
    if (!existing) return null;
    const r = await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        ...(patch.name ? { name: patch.name as Prisma.InputJsonValue } : {}),
        ...(patch.description !== undefined ? { description: patch.description ? (patch.description as Prisma.InputJsonValue) : Prisma.JsonNull } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.mapsUrl !== undefined ? { mapsUrl: patch.mapsUrl } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.checkInTime ? { checkInTime: patch.checkInTime } : {}),
        ...(patch.checkOutTime ? { checkOutTime: patch.checkOutTime } : {}),
        ...(patch.amenities ? { amenities: patch.amenities as Prisma.InputJsonValue } : {}),
        ...(patch.imageUrls ? { imageUrls: patch.imageUrls as Prisma.InputJsonValue } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    return toProperty(r);
  }
}

const toHold = (r: { id: string; tenantId: string; customerId: string; conversationId: string | null; offeringId: string; resourceId: string; startAt: Date; endAt: Date; status: string; expiresAt: Date }): BookingHoldRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  customerId: r.customerId,
  conversationId: r.conversationId ?? undefined,
  offeringId: r.offeringId,
  resourceId: r.resourceId,
  startAt: r.startAt.toISOString(),
  endAt: r.endAt.toISOString(),
  status: r.status as BookingHoldRecord["status"],
  expiresAt: r.expiresAt.toISOString(),
});

type Tx = Prisma.TransactionClient;

/**
 * Night inventory on Postgres. Both writes lock the room type's Offering row (`FOR UPDATE`) and
 * recount occupancy inside the transaction, so concurrent customers cannot oversell a room type.
 */
export class PrismaStayRepository implements StayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async occupancy(tenantId: string, offeringId: string, from: Date, to: Date, blockingStatuses: string[], now: Date): Promise<StayOccupancy> {
    return this.occupancyWith(this.prisma, tenantId, offeringId, from, to, blockingStatuses, now);
  }

  private async occupancyWith(db: Tx | PrismaClient, tenantId: string, offeringId: string, from: Date, to: Date, blockingStatuses: string[], now: Date): Promise<StayOccupancy> {
    const [orders, holds] = await Promise.all([
      db.order.findMany({
        where: { tenantId, kind: "stay", status: { in: blockingStatuses }, scheduledAt: { lt: to }, checkOutAt: { gt: from }, items: { some: { offeringId } } },
        select: { id: true, scheduledAt: true, checkOutAt: true },
      }),
      db.bookingHold.findMany({ where: { tenantId, resourceId: offeringId, status: "held", expiresAt: { gt: now }, startAt: { lt: to }, endAt: { gt: from } } }),
    ]);
    return {
      stays: orders.filter((o) => o.scheduledAt && o.checkOutAt).map((o) => ({ orderId: o.id, startAt: o.scheduledAt!, endAt: o.checkOutAt! })),
      holds: holds.map((h) => ({ id: h.id, customerId: h.customerId, startAt: h.startAt, endAt: h.endAt })),
    };
  }

  async createHold(input: CreateHoldInput, blockingStatuses: string[], units: number, nightStarts: Date[], now: Date): Promise<BookingHoldRecord> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Offering" WHERE id = ${input.offeringId} FOR UPDATE`;
      const occ = await this.occupancyWith(tx, input.tenantId, input.offeringId, input.startAt, input.endAt, blockingStatuses, now);
      const taken = [...occ.stays, ...occ.holds.filter((h) => h.customerId !== input.customerId)];
      if (freeUnits(units, { startAt: input.startAt, endAt: input.endAt }, taken, nightStarts) <= 0) throw new SlotTakenError("no room left for those nights");
      return toHold(await tx.bookingHold.create({ data: { ...input, resourceId: input.offeringId } }));
    });
  }

  async createStay(input: CreateStayInput, blockingStatuses: string[], units: number, nightStarts: Date[], now: Date, outbox?: OutboxFactory): Promise<Order> {
    const offeringId = input.items[0]?.offeringId ?? "";
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Offering" WHERE id = ${offeringId} FOR UPDATE`;
      const occ = await this.occupancyWith(tx, input.tenantId, offeringId, input.scheduledAt, input.checkOutAt, blockingStatuses, now);
      const taken = [...occ.stays, ...occ.holds.filter((h) => h.id !== input.holdId)];
      if (freeUnits(units, { startAt: input.scheduledAt, endAt: input.checkOutAt }, taken, nightStarts) <= 0) throw new SlotTakenError("no room left for those nights");
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
          scheduledAt: input.scheduledAt,
          checkOutAt: input.checkOutAt,
          guests: input.guests,
          propertyId: input.propertyId,
          items: { create: orderItemsCreate(input.items) },
          events: { create: { tenantId: input.tenantId, type: "order.placed", payload: {} } },
        },
        include: { items: true },
      });
      const order = toOrder(row);
      if (outbox) await tx.outboxEvent.create({ data: toOutboxRow(outbox(order)) });
      return order;
    });
  }
}

export class PrismaMediaRepository implements MediaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(input: { tenantId: string; mimeType: string; data: Buffer }): Promise<MediaAssetRecord> {
    const r = await this.prisma.mediaAsset.create({ data: { tenantId: input.tenantId, mimeType: input.mimeType, sizeBytes: input.data.byteLength, data: new Uint8Array(input.data) }, select: { id: true, tenantId: true, mimeType: true, sizeBytes: true, createdAt: true } });
    return { ...r, createdAt: r.createdAt.toISOString() };
  }

  async get(id: string): Promise<(MediaAssetRecord & { data: Buffer }) | null> {
    const r = await this.prisma.mediaAsset.findUnique({ where: { id } });
    return r ? { id: r.id, tenantId: r.tenantId, mimeType: r.mimeType, sizeBytes: r.sizeBytes, createdAt: r.createdAt.toISOString(), data: Buffer.from(r.data as Uint8Array) } : null;
  }
}
