import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type DomainEvent, formatMoney, localized, type Offering, type Order, type ProductVariant, vatIncludedIn, vatOnTopOf } from "@ordr/domain";
import type { AppConfig } from "../config";
import { OrderService } from "../orders/order.service";
import { type PaymentEvent, type PaymentProvider } from "../payments/payment-provider";
import type { BlueprintRegistry, CartLine, CartRecord, CartRepository, CatalogRepository, EventBus, OrderRepository, PaymentIntentRecord, PaymentIntentRepository, StockLine, WebhookReceiptRepository } from "../ports";
import { TOKENS } from "../tokens";

export class CommerceError extends Error {
  constructor(
    public readonly code: "not_found" | "out_of_stock" | "empty_cart" | "invalid" | "not_allowed",
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CommerceError";
  }
}

export interface ProductMatch {
  offering: Offering;
  variant?: ProductVariant;
  priceMinor: number;
  available: boolean;
  stock?: number;
}

/** Retail order states (ADR 0004). */
export const RETAIL_STATES = { pendingPayment: "pending_payment", paid: "paid", failed: "failed", cancelled: "cancelled" } as const;

/**
 * Catalog search, carts, checkout and payment outcomes. Every price comes from the catalog at
 * the moment of the call, stock is reserved atomically at checkout, and an order is paid only
 * when `applyPaymentEvent` receives a webhook the provider adapter verified.
 */
@Injectable()
export class CommerceService {
  private readonly logger = new Logger(CommerceService.name);

  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.CartRepository) private readonly carts: CartRepository,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.PaymentIntentRepository) private readonly intents: PaymentIntentRepository,
    @Inject(TOKENS.WebhookReceiptRepository) private readonly receipts: WebhookReceiptRepository,
    @Inject(TOKENS.PaymentProvider) private readonly provider: PaymentProvider,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
    @Inject(OrderService) private readonly orderService: OrderService,
  ) {}

  /** Simple relevance search over names and descriptions in every language, with an optional price ceiling. */
  async searchProducts(tenantId: string, query: string, opts: { maxPriceMinor?: number; language?: string; limit?: number } = {}): Promise<ProductMatch[]> {
    const [offerings, categories] = await Promise.all([this.catalog.listAllOfferings(tenantId), this.catalog.listCategories(tenantId)]);
    const categoryNames = new Map(categories.map((c) => [c.id, Object.values(c.name).join(" ")]));
    const all = offerings.filter((o) => o.isActive && o.type === "product");
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    const scored = all
      .map((o) => {
        const hay = [...Object.values(o.name), ...Object.values(o.description ?? {}), categoryNames.get(o.categoryId ?? "") ?? "", ...(o.variants ?? []).flatMap((v) => Object.values(v.name))].join(" ").toLowerCase();
        const score = terms.length === 0 ? 1 : terms.filter((t) => hay.includes(t)).length;
        return { o, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.o.sortOrder - b.o.sortOrder);
    const out: ProductMatch[] = [];
    for (const { o } of scored) {
      const variants = (o.variants ?? []).filter((v) => v.isActive);
      if (variants.length === 0) {
        const price = o.priceMinor;
        if (opts.maxPriceMinor !== undefined && price > opts.maxPriceMinor) continue;
        out.push({ offering: o, priceMinor: price, available: o.stock === undefined || o.stock > 0, stock: o.stock });
      } else {
        const cheapest = Math.min(...variants.map((v) => v.priceMinor ?? o.priceMinor));
        if (opts.maxPriceMinor !== undefined && cheapest > opts.maxPriceMinor) continue;
        out.push({ offering: o, priceMinor: cheapest, available: variants.some((v) => v.stock === undefined || v.stock > 0) });
      }
      if (out.length >= (opts.limit ?? 8)) break;
    }
    return out;
  }

  async product(tenantId: string, offeringId: string): Promise<Offering | null> {
    const o = await this.catalog.getOffering(tenantId, offeringId);
    return o && o.isActive && o.type === "product" ? o : null;
  }

  async cart(tenantId: string, customerId: string): Promise<CartRecord | null> {
    return this.carts.findOpen(tenantId, customerId);
  }

  /** Adds or raises a line after checking the item exists and has stock for the requested total. */
  async addToCart(tenantId: string, customerId: string, input: { offeringId: string; variantId?: string; quantity: number; language?: string; conversationId?: string }): Promise<CartRecord> {
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 50) throw new CommerceError("invalid", "quantity must be between 1 and 50");
    const offering = await this.product(tenantId, input.offeringId);
    if (!offering) throw new CommerceError("not_found", "that product is not available");
    const variants = (offering.variants ?? []).filter((v) => v.isActive);
    let variant: ProductVariant | undefined;
    if (variants.length) {
      variant = variants.find((v) => v.id === input.variantId);
      if (!variant) throw new CommerceError("invalid", `choose a variant: ${variants.map((v) => `${v.id} (${localized(v.name, input.language ?? "en")})`).join(", ")}`);
    }
    const cart = (await this.carts.findOpen(tenantId, customerId)) ?? (await this.carts.create(tenantId, customerId, offering.currency, input.conversationId));
    const existing = cart.items.find((l) => l.offeringId === offering.id && (l.variantId ?? null) === (variant?.id ?? null));
    const wanted = (existing?.quantity ?? 0) + input.quantity;
    const stock = variant ? variant.stock : offering.stock;
    if (stock !== undefined && stock < wanted) throw new CommerceError("out_of_stock", `only ${stock} left of ${localized(offering.name, input.language ?? "en")}${variant ? ` ${localized(variant.name, input.language ?? "en")}` : ""}`, { available: stock });
    const unit = variant?.priceMinor ?? offering.priceMinor;
    const title = localized(offering.name, input.language ?? "en");
    if (existing) {
      existing.quantity = wanted;
      existing.unitPriceMinor = unit;
      existing.lineTotalMinor = unit * wanted;
    } else {
      cart.items.push({ offeringId: offering.id, variantId: variant?.id, title, variantTitle: variant ? localized(variant.name, input.language ?? "en") : undefined, quantity: input.quantity, unitPriceMinor: unit, lineTotalMinor: unit * input.quantity });
    }
    cart.conversationId = input.conversationId ?? cart.conversationId;
    cart.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    return this.carts.save(cart);
  }

  async removeFromCart(tenantId: string, customerId: string, input: { offeringId: string; variantId?: string; quantity?: number }): Promise<CartRecord> {
    const cart = await this.carts.findOpen(tenantId, customerId);
    if (!cart) throw new CommerceError("not_found", "the cart is empty");
    const line = cart.items.find((l) => l.offeringId === input.offeringId && (l.variantId ?? null) === (input.variantId ?? null));
    if (!line) throw new CommerceError("not_found", "that item is not in the cart");
    const remove = input.quantity ?? line.quantity;
    line.quantity -= remove;
    line.lineTotalMinor = line.quantity * line.unitPriceMinor;
    cart.items = cart.items.filter((l) => l.quantity > 0);
    return this.carts.save(cart);
  }

  /** Totals with the tenant's VAT rules, recomputed from live catalog prices. */
  async quote(tenantId: string, cart: CartRecord): Promise<{ subtotalMinor: number; vatMinor: number; totalMinor: number; currency: string; repriced: boolean; items: CartLine[] }> {
    const s = await this.orderService.settingsFor(tenantId);
    let repriced = false;
    const items: CartLine[] = [];
    for (const line of cart.items) {
      const o = await this.product(tenantId, line.offeringId);
      if (!o) {
        repriced = true;
        continue;
      }
      const v = line.variantId ? (o.variants ?? []).find((x) => x.id === line.variantId && x.isActive) : undefined;
      if (line.variantId && !v) {
        repriced = true;
        continue;
      }
      const unit = v?.priceMinor ?? o.priceMinor;
      if (unit !== line.unitPriceMinor) repriced = true;
      items.push({ ...line, unitPriceMinor: unit, lineTotalMinor: unit * line.quantity });
    }
    const subtotalMinor = items.reduce((n, l) => n + l.lineTotalMinor, 0);
    const vatMinor = s.vatInclusive ? vatIncludedIn(subtotalMinor, s.vatRate) : vatOnTopOf(subtotalMinor, s.vatRate);
    const totalMinor = s.vatInclusive ? subtotalMinor : subtotalMinor + vatMinor;
    return { subtotalMinor, vatMinor, totalMinor, currency: cart.currency, repriced, items };
  }

  /**
   * Reserves stock, creates the order in pending_payment and a hosted checkout. Returns the
   * link the customer pays at. Throws out_of_stock with the shortages when the catalog moved.
   */
  async checkout(tenantId: string, customerId: string, input: { conversationId?: string; source?: Order["source"]; fulfillmentType?: string; language?: string }): Promise<{ order: Order; intent: PaymentIntentRecord; repriced: boolean }> {
    const cart = await this.carts.findOpen(tenantId, customerId);
    if (!cart || cart.items.length === 0) throw new CommerceError("empty_cart", "the cart is empty");
    const q = await this.quote(tenantId, cart);
    if (q.items.length === 0) throw new CommerceError("not_found", "nothing in the cart is still available");
    const lines: StockLine[] = q.items.map((l) => ({ offeringId: l.offeringId, variantId: l.variantId, quantity: l.quantity }));
    const reserved = await this.catalog.reserveStock(tenantId, lines);
    if (!reserved.ok) throw new CommerceError("out_of_stock", `not enough stock: ${reserved.shortages.map((s) => `${this.lineTitle(q.items, s)} (${s.available} left)`).join(", ")}`, { shortages: reserved.shortages });
    const settings = await this.orderService.settingsFor(tenantId);
    const blueprint = this.blueprints.get(settings.tenant.blueprintId);
    const fulfillmentType = input.fulfillmentType ?? blueprint?.fulfillmentTypes[0] ?? "pickup";
    const eventId = randomUUID();
    let order: Order;
    try {
      order = await this.orders.create(
        {
          tenantId,
          customerId,
          conversationId: input.conversationId ?? cart.conversationId,
          kind: "order",
          initialStatus: RETAIL_STATES.pendingPayment,
          fulfillmentType,
          source: input.source ?? "web",
          items: q.items.map((l) => ({ offeringId: l.offeringId, variantId: l.variantId, variantTitle: l.variantTitle, title: l.title, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, modifiers: [], lineTotalMinor: l.lineTotalMinor })),
          currency: q.currency,
          subtotalMinor: q.subtotalMinor,
          deliveryFeeMinor: 0,
          vatMinor: q.vatMinor,
          totalMinor: q.totalMinor,
          paymentStatus: "pending",
          paymentMethod: this.provider.name,
        },
        (o) => this.event(eventId, "order.checkout_created", o, { totalMinor: o.totalMinor }),
      );
    } catch (err) {
      await this.catalog.releaseStock(tenantId, lines);
      throw err;
    }
    await this.publish(this.event(eventId, "order.checkout_created", order, { totalMinor: order.totalMinor }));
    const intentId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.CHECKOUT_MINUTES * 60_000);
    const checkout = await this.provider.createCheckout({ intentId, tenantId, orderId: order.id, amountMinor: order.totalMinor, currency: order.currency, description: `Order #${order.number}`, returnUrl: `${this.config.PUBLIC_BASE_URL}/pay/${intentId}` });
    const intent = await this.intents.create({ id: intentId, tenantId, orderId: order.id, provider: this.provider.name, amountMinor: order.totalMinor, currency: order.currency, checkoutUrl: checkout.checkoutUrl, providerRef: checkout.providerRef, expiresAt: expiresAt.toISOString() });
    cart.status = "checked_out";
    await this.carts.save(cart);
    this.logger.log(`order #${order.number} awaiting payment (${formatMoney(order.totalMinor, order.currency)}) via ${this.provider.name}`);
    return { order, intent, repriced: q.repriced };
  }

  /** Verifies the raw webhook, dedupes on the provider's event id and moves the order once. */
  async handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ accepted: boolean; applied: boolean; order?: Order }> {
    const event = this.provider.verifyWebhook(rawBody, headers);
    if (!event) return { accepted: false, applied: false };
    return { accepted: true, ...(await this.applyPaymentEvent(event)) };
  }

  async applyPaymentEvent(event: PaymentEvent): Promise<{ applied: boolean; order?: Order }> {
    if (!(await this.receipts.claim(this.provider.name, event.eventId))) {
      this.logger.log(`payment event ${event.eventId} already processed; ignoring replay`);
      return { applied: false };
    }
    const intent = await this.intents.findById(event.intentId);
    if (!intent) {
      this.logger.warn(`payment event ${event.eventId} for unknown intent ${event.intentId}`);
      return { applied: false };
    }
    if (intent.status !== "pending") return { applied: false };
    if (event.status === "paid" && event.amountMinor !== undefined && event.amountMinor !== intent.amountMinor) {
      this.logger.error(`payment event ${event.eventId}: amount ${event.amountMinor} does not match intent ${intent.amountMinor}; not applied`);
      return { applied: false };
    }
    const order = await this.orders.findById(intent.tenantId, intent.orderId);
    if (!order) return { applied: false };
    if (event.status === "paid") {
      await this.intents.setStatus(intent.id, "paid", { providerRef: event.providerRef, paidAt: new Date() });
      const eventId = randomUUID();
      const updated = await this.orders.updatePayment(intent.tenantId, order.id, "paid", RETAIL_STATES.paid, { type: "order.paid", payload: { providerRef: event.providerRef } }, (o) => this.event(eventId, "order.status_changed", o, { from: order.status, to: RETAIL_STATES.paid }));
      await this.publish(this.event(eventId, "order.status_changed", updated, { from: order.status, to: RETAIL_STATES.paid }));
      this.logger.log(`order #${order.number} paid (${event.providerRef ?? event.eventId})`);
      return { applied: true, order: updated };
    }
    await this.intents.setStatus(intent.id, "failed", { providerRef: event.providerRef });
    await this.catalog.releaseStock(intent.tenantId, order.items.map((i) => ({ offeringId: i.offeringId, variantId: i.variantId, quantity: i.quantity })));
    const updated = await this.orders.updatePayment(intent.tenantId, order.id, "failed", RETAIL_STATES.failed, { type: "order.payment_failed", payload: { providerRef: event.providerRef } });
    return { applied: true, order: updated };
  }

  /** Releases stock and cancels orders whose checkout deadline passed. Run by the worker. */
  async expireCheckouts(now = new Date()): Promise<number> {
    const expired = await this.intents.listExpired(now);
    for (const intent of expired) {
      const order = await this.orders.findById(intent.tenantId, intent.orderId);
      await this.intents.setStatus(intent.id, "expired");
      if (order && order.status === RETAIL_STATES.pendingPayment) {
        await this.catalog.releaseStock(intent.tenantId, order.items.map((i) => ({ offeringId: i.offeringId, variantId: i.variantId, quantity: i.quantity })));
        await this.orders.updatePayment(intent.tenantId, order.id, "failed", RETAIL_STATES.cancelled, { type: "order.checkout_expired" });
      }
    }
    return expired.length;
  }

  async intent(intentId: string): Promise<{ intent: PaymentIntentRecord; order: Order } | null> {
    const intent = await this.intents.findById(intentId);
    if (!intent) return null;
    const order = await this.orders.findById(intent.tenantId, intent.orderId);
    return order ? { intent, order } : null;
  }

  async recentOrders(tenantId: string, customerId: string, limit = 5): Promise<Order[]> {
    const rows = await this.orders.listRecent(tenantId, { limit: 200 });
    return rows.filter((o) => o.customerId === customerId && o.kind === "order").slice(0, limit);
  }

  private lineTitle(items: CartLine[], s: StockLine): string {
    const l = items.find((i) => i.offeringId === s.offeringId && (i.variantId ?? null) === (s.variantId ?? null));
    return l ? `${l.title}${l.variantTitle ? ` ${l.variantTitle}` : ""}` : s.offeringId;
  }

  private event(id: string, type: string, order: Order, payload: Record<string, unknown>): DomainEvent {
    return { id, type, tenantId: order.tenantId, occurredAt: new Date().toISOString(), subject: { kind: "order", id: order.id }, payload: { orderNumber: order.number, customerId: order.customerId, status: order.status, ...payload } };
  }

  private async publish(event: DomainEvent): Promise<void> {
    try {
      await this.bus.publish(event);
    } catch (err) {
      this.logger.error(`event ${event.type} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
