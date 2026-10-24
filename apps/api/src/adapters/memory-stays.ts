import { freeUnits, type Order, type Property, SlotTakenError } from "@ordr/domain";
import type { BookingHoldRecord, BookingHoldRepository, CreateHoldInput, CreateStayInput, MediaAssetRecord, MediaRepository, OrderRepository, OutboxFactory, PropertyInput, PropertyRepository, StayOccupancy, StayRepository } from "../ports";

let seq = 0;
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${++seq}`;

export class InMemoryPropertyRepository implements PropertyRepository {
  constructor(readonly properties: Property[] = []) {}

  async list(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<Property[]> {
    return this.properties
      .filter((p) => p.tenantId === tenantId && (opts.includeInactive || p.isActive))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => structuredClone(p));
  }

  async get(tenantId: string, propertyId: string): Promise<Property | null> {
    const p = this.properties.find((x) => x.tenantId === tenantId && x.id === propertyId);
    return p ? structuredClone(p) : null;
  }

  async create(tenantId: string, input: PropertyInput): Promise<Property> {
    const p: Property = {
      id: nextId("prop"),
      tenantId,
      name: { ...input.name },
      description: input.description ? { ...input.description } : undefined,
      address: input.address ?? undefined,
      mapsUrl: input.mapsUrl ?? undefined,
      phone: input.phone ?? undefined,
      checkInTime: input.checkInTime ?? "15:00",
      checkOutTime: input.checkOutTime ?? "12:00",
      amenities: [...(input.amenities ?? [])],
      imageUrls: [...(input.imageUrls ?? [])],
      sortOrder: input.sortOrder ?? this.properties.length,
      isActive: input.isActive ?? true,
    };
    this.properties.push(p);
    return structuredClone(p);
  }

  async update(tenantId: string, propertyId: string, patch: Partial<PropertyInput>): Promise<Property | null> {
    const p = this.properties.find((x) => x.tenantId === tenantId && x.id === propertyId);
    if (!p) return null;
    if (patch.name) p.name = { ...patch.name };
    if (patch.description !== undefined) p.description = patch.description ? { ...patch.description } : undefined;
    if (patch.address !== undefined) p.address = patch.address ?? undefined;
    if (patch.mapsUrl !== undefined) p.mapsUrl = patch.mapsUrl ?? undefined;
    if (patch.phone !== undefined) p.phone = patch.phone ?? undefined;
    if (patch.checkInTime) p.checkInTime = patch.checkInTime;
    if (patch.checkOutTime) p.checkOutTime = patch.checkOutTime;
    if (patch.amenities) p.amenities = [...patch.amenities];
    if (patch.imageUrls) p.imageUrls = [...patch.imageUrls];
    if (patch.sortOrder !== undefined) p.sortOrder = patch.sortOrder;
    if (patch.isActive !== undefined) p.isActive = patch.isActive;
    return structuredClone(p);
  }
}

/**
 * Night inventory over the in-memory orders and holds. Holds live in the shared hold repository
 * with the room type id as `resourceId`, so expiry and release work exactly as for salon holds.
 */
export class InMemoryStayRepository implements StayRepository {
  constructor(
    private readonly orders: OrderRepository & { readonly orders: Order[] },
    private readonly holds: BookingHoldRepository & { readonly holds: BookingHoldRecord[] },
  ) {}

  async occupancy(tenantId: string, offeringId: string, from: Date, to: Date, blockingStatuses: string[], now: Date): Promise<StayOccupancy> {
    const stays = this.orders.orders
      .filter((o) => o.tenantId === tenantId && o.kind === "stay" && o.scheduledAt && o.checkOutAt && blockingStatuses.includes(o.status) && o.items.some((i) => i.offeringId === offeringId))
      .filter((o) => new Date(o.scheduledAt!) < to && from < new Date(o.checkOutAt!))
      .map((o) => ({ orderId: o.id, startAt: new Date(o.scheduledAt!), endAt: new Date(o.checkOutAt!) }));
    const holds = this.holds.holds
      .filter((h) => h.tenantId === tenantId && h.resourceId === offeringId && h.status === "held" && new Date(h.expiresAt) > now)
      .filter((h) => new Date(h.startAt) < to && from < new Date(h.endAt))
      .map((h) => ({ id: h.id, customerId: h.customerId, startAt: new Date(h.startAt), endAt: new Date(h.endAt) }));
    return { stays, holds };
  }

  async createHold(input: CreateHoldInput, blockingStatuses: string[], units: number, nightStarts: Date[], now: Date): Promise<BookingHoldRecord> {
    const occ = await this.occupancy(input.tenantId, input.offeringId, input.startAt, input.endAt, blockingStatuses, now);
    const taken = [...occ.stays, ...occ.holds.filter((h) => h.customerId !== input.customerId)];
    if (freeUnits(units, { startAt: input.startAt, endAt: input.endAt }, taken, nightStarts) <= 0) throw new SlotTakenError("no room left for those nights");
    const hold: BookingHoldRecord = { id: nextId("hold"), tenantId: input.tenantId, customerId: input.customerId, conversationId: input.conversationId, offeringId: input.offeringId, resourceId: input.offeringId, startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString(), status: "held", expiresAt: input.expiresAt.toISOString() };
    this.holds.holds.push(hold);
    return structuredClone(hold);
  }

  async createStay(input: CreateStayInput, blockingStatuses: string[], units: number, nightStarts: Date[], now: Date, outbox?: OutboxFactory): Promise<Order> {
    const offeringId = input.items[0]?.offeringId ?? "";
    const occ = await this.occupancy(input.tenantId, offeringId, input.scheduledAt, input.checkOutAt, blockingStatuses, now);
    const taken = [...occ.stays, ...occ.holds.filter((h) => h.id !== input.holdId)];
    if (freeUnits(units, { startAt: input.scheduledAt, endAt: input.checkOutAt }, taken, nightStarts) <= 0) throw new SlotTakenError("no room left for those nights");
    if (input.holdId) await this.holds.setStatus(input.holdId, "confirmed");
    const { holdId: _h, ...rest } = input;
    return this.orders.create(rest, outbox);
  }
}

export class InMemoryMediaRepository implements MediaRepository {
  readonly assets = new Map<string, MediaAssetRecord & { data: Buffer }>();

  async save(input: { tenantId: string; mimeType: string; data: Buffer }): Promise<MediaAssetRecord> {
    const rec = { id: nextId("media"), tenantId: input.tenantId, mimeType: input.mimeType, sizeBytes: input.data.byteLength, createdAt: new Date().toISOString(), data: input.data };
    this.assets.set(rec.id, rec);
    const { data: _d, ...meta } = rec;
    return meta;
  }

  async get(id: string): Promise<(MediaAssetRecord & { data: Buffer }) | null> {
    return this.assets.get(id) ?? null;
  }
}
