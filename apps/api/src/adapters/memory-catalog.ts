import { type Category, type DomainEvent, type ModifierGroup, type Offering, type Order, overlaps, type Resource, SlotTakenError } from "@ordr/domain";
import type {
  CatalogRepository,
  CategoryInput,
  CreateBookingInput,
  CreateOrderInput,
  EventBus,
  EventHandler,
  ModifierGroupInput,
  OfferingInput,
  OrderRepository,
  OutboxFactory,
  OutboxRecord,
  OutboxStore,
  ResourceInput,
  ResourceRepository,
} from "../ports";

export class InMemoryResourceRepository implements ResourceRepository {
  constructor(readonly resources: Resource[] = []) {}

  async list(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<Resource[]> {
    return this.resources
      .filter((r) => r.tenantId === tenantId && (opts.includeInactive || r.isActive))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => structuredClone(r));
  }

  async get(tenantId: string, resourceId: string): Promise<Resource | null> {
    const r = this.resources.find((x) => x.tenantId === tenantId && x.id === resourceId);
    return r ? structuredClone(r) : null;
  }

  async create(tenantId: string, input: ResourceInput): Promise<Resource> {
    const r: Resource = {
      id: catalogId("res"),
      tenantId,
      type: input.type ?? "staff",
      name: { ...input.name },
      hours: structuredClone(input.hours ?? {}),
      skills: [...(input.skills ?? [])],
      sortOrder: input.sortOrder ?? this.resources.length,
      isActive: input.isActive ?? true,
    };
    this.resources.push(r);
    return structuredClone(r);
  }

  async update(tenantId: string, resourceId: string, patch: Partial<ResourceInput>): Promise<Resource | null> {
    const r = this.resources.find((x) => x.tenantId === tenantId && x.id === resourceId);
    if (!r) return null;
    if (patch.name) r.name = { ...patch.name };
    if (patch.type) r.type = patch.type;
    if (patch.hours) r.hours = structuredClone(patch.hours);
    if (patch.skills) r.skills = [...patch.skills];
    if (patch.sortOrder !== undefined) r.sortOrder = patch.sortOrder;
    if (patch.isActive !== undefined) r.isActive = patch.isActive;
    return structuredClone(r);
  }
}

let catalogSeq = 0;
const catalogId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${++catalogSeq}`;

function buildGroups(groups: ModifierGroupInput[]): ModifierGroup[] {
  return groups.map((g, gi) => ({
    id: catalogId("grp"),
    name: { ...g.name },
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    sortOrder: g.sortOrder ?? gi,
    options: g.options.map((o, oi) => ({ id: catalogId("opt"), name: { ...o.name }, priceDeltaMinor: o.priceDeltaMinor, sortOrder: o.sortOrder ?? oi, isActive: o.isActive ?? true })),
  }));
}

export class InMemoryCatalogRepository implements CatalogRepository {
  constructor(
    private readonly categories: Category[] = [],
    private readonly offerings: Offering[] = [],
  ) {}

  async listCategories(tenantId: string): Promise<Category[]> {
    return this.categories.filter((c) => c.tenantId === tenantId && c.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listOfferings(tenantId: string, categoryId: string): Promise<Offering[]> {
    return this.offerings
      .filter((o) => o.tenantId === tenantId && o.categoryId === categoryId && o.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getOffering(tenantId: string, offeringId: string): Promise<Offering | null> {
    return this.offerings.find((o) => o.tenantId === tenantId && o.id === offeringId) ?? null;
  }

  async listAllCategories(tenantId: string): Promise<Category[]> {
    return this.categories.filter((c) => c.tenantId === tenantId).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => structuredClone(c));
  }

  async listAllOfferings(tenantId: string): Promise<Offering[]> {
    return this.offerings.filter((o) => o.tenantId === tenantId).sort((a, b) => a.sortOrder - b.sortOrder).map((o) => structuredClone(o));
  }

  async createCategory(tenantId: string, input: CategoryInput): Promise<Category> {
    const category: Category = { id: catalogId("cat"), tenantId, name: { ...input.name }, sortOrder: input.sortOrder ?? this.categories.length, isActive: input.isActive ?? true };
    this.categories.push(category);
    return structuredClone(category);
  }

  async updateCategory(tenantId: string, categoryId: string, patch: Partial<CategoryInput>): Promise<Category | null> {
    const c = this.categories.find((x) => x.tenantId === tenantId && x.id === categoryId);
    if (!c) return null;
    if (patch.name) c.name = { ...patch.name };
    if (patch.sortOrder !== undefined) c.sortOrder = patch.sortOrder;
    if (patch.isActive !== undefined) c.isActive = patch.isActive;
    return structuredClone(c);
  }

  async createOffering(tenantId: string, input: OfferingInput): Promise<Offering> {
    const offering: Offering = {
      id: catalogId("it"),
      tenantId,
      categoryId: input.categoryId ?? undefined,
      type: input.type ?? "product",
      name: { ...input.name },
      description: input.description ? { ...input.description } : undefined,
      priceMinor: input.priceMinor,
      currency: input.currency ?? "AED",
      durationMinutes: input.durationMinutes ?? undefined,
      imageUrl: input.imageUrl ?? undefined,
      sortOrder: input.sortOrder ?? this.offerings.length,
      isActive: input.isActive ?? true,
      modifierGroups: buildGroups(input.modifierGroups ?? []),
    };
    this.offerings.push(offering);
    return structuredClone(offering);
  }

  async updateOffering(tenantId: string, offeringId: string, patch: Partial<OfferingInput>): Promise<Offering | null> {
    const o = this.offerings.find((x) => x.tenantId === tenantId && x.id === offeringId);
    if (!o) return null;
    if (patch.categoryId !== undefined) o.categoryId = patch.categoryId ?? undefined;
    if (patch.type) o.type = patch.type;
    if (patch.name) o.name = { ...patch.name };
    if (patch.description !== undefined) o.description = patch.description ? { ...patch.description } : undefined;
    if (patch.priceMinor !== undefined) o.priceMinor = patch.priceMinor;
    if (patch.currency) o.currency = patch.currency;
    if (patch.durationMinutes !== undefined) o.durationMinutes = patch.durationMinutes ?? undefined;
    if (patch.imageUrl !== undefined) o.imageUrl = patch.imageUrl ?? undefined;
    if (patch.sortOrder !== undefined) o.sortOrder = patch.sortOrder;
    if (patch.isActive !== undefined) o.isActive = patch.isActive;
    if (patch.modifierGroups) o.modifierGroups = buildGroups(patch.modifierGroups);
    return structuredClone(o);
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  readonly orders: Order[] = [];
  readonly history: Array<{ orderId: string; type: string; payload?: unknown }> = [];
  /** Events that would have gone to the outbox table; tests inspect this. */
  readonly outbox: DomainEvent[] = [];
  private readonly sequences = new Map<string, number>();

  async create(input: CreateOrderInput, outbox?: OutboxFactory): Promise<Order> {
    const number = (this.sequences.get(input.tenantId) ?? 0) + 1;
    this.sequences.set(input.tenantId, number);
    const now = new Date().toISOString();
    const { initialStatus, scheduledAt, ...rest } = input;
    const order: Order = { id: `ord_${input.tenantId}_${number}`, number, status: initialStatus, ...rest, scheduledAt: scheduledAt?.toISOString(), createdAt: now, updatedAt: now };
    this.orders.push(order);
    this.history.push({ orderId: order.id, type: "order.placed" });
    if (outbox) this.outbox.push(outbox(structuredClone(order)));
    return structuredClone(order);
  }

  async createBooking(input: CreateBookingInput, blockingStatuses: string[], outbox?: OutboxFactory): Promise<Order> {
    const start = input.scheduledAt;
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    const clash = this.orders.some((o) => {
      if (o.tenantId !== input.tenantId || o.resourceId !== input.resourceId || !o.scheduledAt || !blockingStatuses.includes(o.status)) return false;
      const s = new Date(o.scheduledAt);
      return overlaps(start, end, s, new Date(s.getTime() + (o.durationMinutes ?? 0) * 60_000));
    });
    if (clash) throw new SlotTakenError();
    return this.create(input, outbox);
  }

  async listBookings(tenantId: string, opts: { from: Date; to: Date; resourceId?: string; statuses?: string[] }): Promise<Order[]> {
    return this.orders
      .filter((o) => o.tenantId === tenantId && o.scheduledAt)
      .filter((o) => !opts.resourceId || o.resourceId === opts.resourceId)
      .filter((o) => !opts.statuses || opts.statuses.includes(o.status))
      .filter((o) => {
        const at = new Date(o.scheduledAt!);
        return at >= opts.from && at < opts.to;
      })
      .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
      .map((o) => structuredClone(o));
  }

  async findById(tenantId: string, orderId: string): Promise<Order | null> {
    const o = this.orders.find((x) => x.tenantId === tenantId && x.id === orderId);
    return o ? structuredClone(o) : null;
  }

  async latestForCustomer(tenantId: string, customerId: string): Promise<Order | null> {
    const mine = this.orders.filter((x) => x.tenantId === tenantId && x.customerId === customerId);
    const latest = mine[mine.length - 1];
    return latest ? structuredClone(latest) : null;
  }

  async updateStatus(tenantId: string, orderId: string, status: string, event: { type: string; payload?: unknown }, outbox?: OutboxFactory): Promise<Order> {
    const o = this.orders.find((x) => x.tenantId === tenantId && x.id === orderId);
    if (!o) throw new Error(`order ${orderId} not found`);
    o.status = status;
    o.updatedAt = new Date().toISOString();
    this.history.push({ orderId, ...event });
    if (outbox) this.outbox.push(outbox(structuredClone(o)));
    return structuredClone(o);
  }

  async listByStatus(tenantId: string, statuses: string[], limit = 50): Promise<Order[]> {
    return this.orders
      .filter((x) => x.tenantId === tenantId && statuses.includes(x.status))
      .slice(0, limit)
      .map((o) => structuredClone(o));
  }

  async listRecent(tenantId: string, opts: { statuses?: string[]; since?: Date; limit?: number } = {}): Promise<Order[]> {
    const limit = opts.limit ?? 100;
    return this.orders
      .filter((x) => x.tenantId === tenantId)
      .filter((x) => !opts.statuses || opts.statuses.includes(x.status))
      .filter((x) => !opts.since || new Date(x.updatedAt) >= opts.since)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number)
      .slice(0, limit)
      .map((o) => structuredClone(o));
  }
}

type MemoryOutboxRow = OutboxRecord & { status: "pending" | "processing" | "sent" | "failed"; nextAttemptAt: number; claimedAt?: number; lastError?: string };

/** Outbox semantics in memory, for relay tests. */
export class InMemoryOutboxStore implements OutboxStore {
  readonly rows: MemoryOutboxRow[] = [];

  add(event: DomainEvent, at = new Date()): void {
    if (this.rows.some((r) => r.id === event.id)) return;
    this.rows.push({ ...structuredClone(event), attempts: 0, status: "pending", nextAttemptAt: at.getTime() });
  }

  async claim(limit: number, now = new Date()): Promise<OutboxRecord[]> {
    const due = this.rows
      .filter((r) => r.status === "pending" && r.nextAttemptAt <= now.getTime())
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .slice(0, limit);
    for (const r of due) {
      r.status = "processing";
      r.attempts += 1;
      r.claimedAt = now.getTime();
    }
    return due.map(({ status: _s, nextAttemptAt: _n, claimedAt: _c, lastError: _e, ...rec }) => structuredClone(rec));
  }

  async markSent(id: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) r.status = "sent";
  }

  async markFailed(id: string, error: string, retryAt: Date | null): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return;
    r.lastError = error;
    if (retryAt) {
      r.status = "pending";
      r.nextAttemptAt = retryAt.getTime();
    } else {
      r.status = "failed";
    }
  }

  async requeueStale(olderThan: Date): Promise<number> {
    let n = 0;
    for (const r of this.rows) {
      if (r.status === "processing" && (r.claimedAt ?? 0) < olderThan.getTime()) {
        r.status = "pending";
        n += 1;
      }
    }
    return n;
  }

  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of this.rows) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  }
}

export class InMemoryEventBus implements EventBus {
  readonly published: DomainEvent[] = [];
  private readonly handlers = new Map<string, Set<EventHandler>>();

  async publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
    const targets = [...(this.handlers.get(event.type) ?? []), ...(this.handlers.get("*") ?? [])];
    await Promise.all(targets.map((h) => h(event)));
  }

  subscribe(type: string | "*", handler: EventHandler): () => void {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => set.delete(handler);
  }
}
