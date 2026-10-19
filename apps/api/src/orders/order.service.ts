import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { addItem, type Cart, type DeliveryLocation, type DomainEvent, emptyCart, nextState, type Offering, type Order, type Quote, quote as buildQuote, type Tenant } from "@ordr/domain";
import type { BlueprintRegistry, EventBus, OrderRepository, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";

export interface OrderSettings {
  currency: string;
  vatRate: number;
  vatInclusive: boolean;
  deliveryFeeMinor: number;
  paymentMethods: string[];
}

const DEFAULTS: OrderSettings = { currency: "AED", vatRate: 0.05, vatInclusive: true, deliveryFeeMinor: 0, paymentMethods: ["cash"] };

export interface PlaceOrderInput {
  tenantId: string;
  customerId: string;
  conversationId?: string;
  cart: Cart;
  fulfillmentType: string;
  deliveryLocation?: DeliveryLocation;
  notes?: string;
  paymentMethod?: string;
  source?: Order["source"];
}

export interface PlaceBookingInput {
  tenantId: string;
  customerId: string;
  conversationId?: string;
  offering: Offering;
  /** Service name in the customer's language, stored on the line item. */
  title: string;
  resourceId: string;
  startAt: Date;
  durationMinutes: number;
  fulfillmentType: string;
  /** Statuses that make an overlapping booking a conflict. */
  blockingStatuses: string[];
  notes?: string;
  source?: Order["source"];
}

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderError";
  }
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
  ) {}

  /** Blueprint defaults overridden by tenant settings. */
  async settingsFor(tenantId: string): Promise<OrderSettings & { tenant: Tenant }> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new OrderError(`tenant ${tenantId} not found`);
    const blueprint = this.blueprints.get(tenant.blueprintId);
    return { ...DEFAULTS, ...(blueprint?.settings as Partial<OrderSettings>), ...(tenant.settings as Partial<OrderSettings>), tenant };
  }

  async quote(tenantId: string, cart: Cart, fulfillmentType: string): Promise<Quote> {
    const s = await this.settingsFor(tenantId);
    const blueprint = this.blueprints.get(s.tenant.blueprintId);
    if (blueprint && !blueprint.fulfillmentTypes.includes(fulfillmentType)) {
      throw new OrderError(`fulfillment type "${fulfillmentType}" is not offered`);
    }
    return buildQuote(cart, { fulfillmentType, deliveryFeeMinor: s.deliveryFeeMinor, vatRate: s.vatRate, vatInclusive: s.vatInclusive });
  }

  async place(input: PlaceOrderInput): Promise<Order> {
    if (input.cart.items.length === 0) throw new OrderError("cart is empty");
    const s = await this.settingsFor(input.tenantId);
    const blueprint = this.blueprints.get(s.tenant.blueprintId);
    if (!blueprint) throw new OrderError(`blueprint ${s.tenant.blueprintId} not found`);
    if (input.fulfillmentType === "delivery" && !input.deliveryLocation) throw new OrderError("delivery requires a location");
    const q = await this.quote(input.tenantId, input.cart, input.fulfillmentType);
    const paymentMethod = input.paymentMethod ?? s.paymentMethods[0] ?? "cash";

    // The event id is fixed up front so the row the repository writes in its transaction and the
    // publish below describe the same event; the outbox bus de-duplicates on id.
    const eventId = randomUUID();
    const placed = (o: Order) => this.event(eventId, "order.placed", o, { fulfillmentType: o.fulfillmentType, totalMinor: o.totalMinor });
    const order = await this.orders.create(
      {
      tenantId: input.tenantId,
      customerId: input.customerId,
      conversationId: input.conversationId,
      kind: "order",
      initialStatus: blueprint.orderStates.initial,
      fulfillmentType: input.fulfillmentType,
      source: input.source ?? "whatsapp",
      items: input.cart.items.map((i) => ({ ...i })),
      currency: q.currency,
      subtotalMinor: q.subtotalMinor,
      deliveryFeeMinor: q.deliveryFeeMinor,
      vatMinor: q.vatMinor,
      totalMinor: q.totalMinor,
      paymentStatus: "unpaid",
      paymentMethod,
        deliveryLocation: input.deliveryLocation ? { ...input.deliveryLocation, notes: input.notes } : undefined,
        notes: input.notes,
      },
      placed,
    );
    await this.publish(placed(order));
    this.logger.log(`order #${order.number} placed for tenant ${order.tenantId} (${order.fulfillmentType}, ${order.totalMinor} ${order.currency})`);
    return order;
  }

  /** A service booking: one line, a start time, a resource. Throws SlotTakenError on a conflict. */
  async placeBooking(input: PlaceBookingInput): Promise<Order> {
    const s = await this.settingsFor(input.tenantId);
    const blueprint = this.blueprints.get(s.tenant.blueprintId);
    if (!blueprint) throw new OrderError(`blueprint ${s.tenant.blueprintId} not found`);
    const cart = addItem(emptyCart(input.offering.currency), { offeringId: input.offering.id, title: input.title, quantity: 1, unitPriceMinor: input.offering.priceMinor, modifiers: [] });
    const q = buildQuote(cart, { fulfillmentType: input.fulfillmentType, deliveryFeeMinor: 0, vatRate: s.vatRate, vatInclusive: s.vatInclusive });
    const eventId = randomUUID();
    const placed = (o: Order) => this.event(eventId, "order.placed", o, { fulfillmentType: o.fulfillmentType, totalMinor: o.totalMinor, scheduledAt: o.scheduledAt, resourceId: o.resourceId });
    const order = await this.orders.createBooking(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        conversationId: input.conversationId,
        kind: "booking",
        initialStatus: blueprint.orderStates.initial,
        fulfillmentType: input.fulfillmentType,
        source: input.source ?? "whatsapp",
        items: cart.items.map((i) => ({ ...i })),
        currency: q.currency,
        subtotalMinor: q.subtotalMinor,
        deliveryFeeMinor: 0,
        vatMinor: q.vatMinor,
        totalMinor: q.totalMinor,
        paymentStatus: "unpaid",
        paymentMethod: s.paymentMethods[0] ?? "cash",
        notes: input.notes,
        scheduledAt: input.startAt,
        resourceId: input.resourceId,
        durationMinutes: input.durationMinutes,
      },
      input.blockingStatuses,
      placed,
    );
    await this.publish(placed(order));
    this.logger.log(`booking #${order.number} placed for tenant ${order.tenantId} at ${input.startAt.toISOString()} on ${input.resourceId}`);
    return order;
  }

  /** Applies a blueprint transition such as "accept" or "ready" and publishes the change. */
  async transition(tenantId: string, orderId: string, event: string, actor = "system"): Promise<Order> {
    const order = await this.orders.findById(tenantId, orderId);
    if (!order) throw new OrderError(`order ${orderId} not found`);
    const s = await this.settingsFor(tenantId);
    const blueprint = this.blueprints.get(s.tenant.blueprintId);
    if (!blueprint) throw new OrderError(`blueprint ${s.tenant.blueprintId} not found`);
    const to = nextState(blueprint.orderStates, order.status, event);
    const payload = { from: order.status, to, event, actor };
    const eventId = randomUUID();
    const changed = (o: Order) => this.event(eventId, "order.status_changed", o, payload);
    const updated = await this.orders.updateStatus(tenantId, orderId, to, { type: "order.status_changed", payload }, changed);
    await this.publish(changed(updated));
    return updated;
  }

  latestForCustomer(tenantId: string, customerId: string): Promise<Order | null> {
    return this.orders.latestForCustomer(tenantId, customerId);
  }

  private event(id: string, type: string, order: Order, payload: Record<string, unknown>): DomainEvent {
    return {
      id,
      type,
      tenantId: order.tenantId,
      occurredAt: new Date().toISOString(),
      subject: { kind: "order", id: order.id },
      payload: { orderNumber: order.number, customerId: order.customerId, status: order.status, ...payload },
    };
  }

  /** A failing handler must never fail the order change itself; with the outbox the worker retries. */
  private async publish(event: DomainEvent): Promise<void> {
    try {
      await this.bus.publish(event);
    } catch (err) {
      this.logger.error(`event ${event.type} for order ${event.subject.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
