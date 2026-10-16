import type { Category, DomainEvent, Offering, Order } from "@ordr/domain";
import type { CatalogRepository, CreateOrderInput, EventBus, EventHandler, OrderRepository } from "../ports";

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
  private readonly sequences = new Map<string, number>();

  async create(input: CreateOrderInput): Promise<Order> {
    const number = (this.sequences.get(input.tenantId) ?? 0) + 1;
    this.sequences.set(input.tenantId, number);
    const now = new Date().toISOString();
    const { initialStatus, ...rest } = input;
    const order: Order = { id: `ord_${input.tenantId}_${number}`, number, status: initialStatus, ...rest, createdAt: now, updatedAt: now };
    this.orders.push(order);
    this.history.push({ orderId: order.id, type: "order.placed" });
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

  async updateStatus(tenantId: string, orderId: string, status: string, event: { type: string; payload?: unknown }): Promise<Order> {
    const o = this.orders.find((x) => x.tenantId === tenantId && x.id === orderId);
    if (!o) throw new Error(`order ${orderId} not found`);
    o.status = status;
    o.updatedAt = new Date().toISOString();
    this.history.push({ orderId, ...event });
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
