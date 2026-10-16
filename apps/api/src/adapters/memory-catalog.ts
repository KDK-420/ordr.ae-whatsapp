import type { Category, DomainEvent, Offering, Order } from "@ordr/domain";
import type { CatalogRepository, CreateOrderInput, EventBus, EventHandler, OrderRepository, OutboxFactory, OutboxRecord, OutboxStore } from "../ports";

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
    const { initialStatus, ...rest } = input;
    const order: Order = { id: `ord_${input.tenantId}_${number}`, number, status: initialStatus, ...rest, createdAt: now, updatedAt: now };
    this.orders.push(order);
    this.history.push({ orderId: order.id, type: "order.placed" });
    if (outbox) this.outbox.push(outbox(structuredClone(order)));
    return structuredClone(order);
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
