import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { addItem, type Cart, type DeliveryLocation, type DomainEvent, emptyCart, nextState, type Offering, type Order, type Quote, quote as buildQuote, type Tenant } from "@ordr/domain";
import type { BlueprintRegistry, EventBus, OrderRepository, OutboxFactory, OutboxStore, TenantRepository } from "../ports";
import { BOOKING_REMINDER_EVENT, type BookingReminderPayload, reminderEventId } from "./booking-reminder";
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
  /** The customer's own hold on this slot, so the overlap check ignores it. */
  holdId?: string;
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
    @Inject(TOKENS.OutboxStore) private readonly outbox: OutboxStore,
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
        holdId: input.holdId,
      },
      input.blockingStatuses,
      placed,
    );
    await this.publish(placed(order));
    await this.scheduleReminders(order, blueprint.settings, s.tenant.settings);
    this.logger.log(`booking #${order.number} placed for tenant ${order.tenantId} at ${input.startAt.toISOString()} on ${input.resourceId}`);
    return order;
  }

  /**
   * Places an order through any repository write that accepts the outbox factory (stays use their
   * own inventory check), then publishes `order.placed` and queues reminders like placeBooking does.
   */
  async placeThrough(tenantId: string, create: (outbox: OutboxFactory) => Promise<Order>, extra: Record<string, unknown> = {}): Promise<Order> {
    const s = await this.settingsFor(tenantId);
    const blueprint = this.blueprints.get(s.tenant.blueprintId);
    if (!blueprint) throw new OrderError(`blueprint ${s.tenant.blueprintId} not found`);
    const eventId = randomUUID();
    const placed = (o: Order) => this.event(eventId, "order.placed", o, { fulfillmentType: o.fulfillmentType, totalMinor: o.totalMinor, scheduledAt: o.scheduledAt, ...extra });
    const order = await create(placed);
    await this.publish(placed(order));
    await this.scheduleReminders(order, blueprint.settings, s.tenant.settings);
    this.logger.log(`${order.kind} #${order.number} placed for tenant ${order.tenantId}${order.scheduledAt ? ` from ${order.scheduledAt}` : ""}`);
    return order;
  }

  /** Moves a booking to a new slot (overlap-checked by the repository) and queues reminders for the new time. */
  async rescheduleBooking(tenantId: string, orderId: string, input: { startAt: Date; resourceId: string; durationMinutes: number; holdId?: string; blockingStatuses: string[]; actor?: string }): Promise<Order> {
    const s = await this.settingsFor(tenantId);
    const blueprint = this.blueprints.get(s.tenant.blueprintId);
    if (!blueprint) throw new OrderError(`blueprint ${s.tenant.blueprintId} not found`);
    const eventId = randomUUID();
    const moved = (o: Order) => this.event(eventId, "order.rescheduled", o, { scheduledAt: o.scheduledAt, resourceId: o.resourceId, actor: input.actor ?? "customer" });
    const order = await this.orders.reschedule(tenantId, orderId, { scheduledAt: input.startAt, resourceId: input.resourceId, durationMinutes: input.durationMinutes, holdId: input.holdId }, input.blockingStatuses, moved);
    await this.publish(moved(order));
    await this.scheduleReminders(order, blueprint.settings, s.tenant.settings);
    this.logger.log(`booking #${order.number} moved to ${input.startAt.toISOString()} on ${input.resourceId}`);
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

  /**
   * Queues one outbox event per reminder lead time (blueprint or tenant `reminderMinutes`, e.g.
   * [1440, 120]) to fire that long before the appointment. Lead times already in the past are skipped.
   */
  private async scheduleReminders(order: Order, ...settings: Array<Record<string, unknown>>): Promise<void> {
    if (!order.scheduledAt) return;
    // The last settings object wins (tenant over blueprint).
    const configured = settings.map((s) => s.reminderMinutes).filter((v): v is unknown[] => Array.isArray(v)).at(-1);
    const leads = (configured ?? [1440, 120]).filter((m): m is number => typeof m === "number" && m > 0);
    const startsAt = new Date(order.scheduledAt).getTime();
    const now = Date.now();
    for (const leadMinutes of leads) {
      const at = new Date(startsAt - leadMinutes * 60_000);
      if (at.getTime() <= now + 60_000) continue;
      const payload: BookingReminderPayload = { leadMinutes, scheduledAt: order.scheduledAt };
      const event = this.event(reminderEventId(order.id, leadMinutes), BOOKING_REMINDER_EVENT, order, { ...payload });
      try {
        await this.outbox.schedule([event], at);
      } catch (err) {
        this.logger.error(`could not schedule the ${leadMinutes} min reminder for booking #${order.number}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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
