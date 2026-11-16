import { randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { type CartModifier, localized, type Offering, type Order, type OrderItem, vatIncludedIn, vatOnTopOf } from "@ordr/domain";
import { OrderService } from "../orders/order.service";
import type { CatalogRepository, ConversationRepository, OrderRepository } from "../ports";
import { TOKENS } from "../tokens";
import { RealtimeHub } from "./realtime";
import { SuiteService } from "./suite.service";
import type { Branch, OrderPaymentRecord, PaymentMethod, SuiteRepository } from "./types";

/** One line as a till or a storefront cart sends it: ids only, never prices. */
export interface OrderLineInput {
  offeringId: string;
  quantity: number;
  /** Chosen modifier option ids, across all groups of the item. */
  optionIds?: string[];
  notes?: string;
}

export interface DiscountInput {
  type: "percent" | "amount";
  /** Percent (0 to 100) or an amount in minor units. */
  value: number;
  reason?: string;
}

export interface PricedLine extends OrderItem {
  categoryId?: string;
  imageUrl?: string;
}

export interface SuiteQuote {
  currency: string;
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  vatMinor: number;
  vatRate: number;
  vatInclusive: boolean;
  totalMinor: number;
}

export interface CreateSuiteOrderInput {
  tenantId: string;
  source: "pos" | "web";
  branchId?: string;
  /** dine_in, pickup or delivery. */
  fulfillmentType: string;
  lines: OrderLineInput[];
  discount?: DiscountInput;
  tableLabel?: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
  notes?: string;
  /** Makes a retried request return the first order instead of creating another. */
  clientRef?: string;
  language?: string;
  paymentMethod?: string;
  actor?: string;
}

/** Shown to walk-in customers who gave no phone number. One per tenant. */
const WALK_IN_WA_ID = "pos:walk-in";
const MAX_LINES = 60;
const MAX_QUANTITY = 99;

/** Digits of a phone number in international form; UAE local numbers gain their country code. */
export function phoneDigits(raw: string | undefined): string | undefined {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return undefined;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("05") && digits.length === 10) return `971${digits.slice(1)}`;
  return digits;
}

/**
 * The one way POS and the storefront create restaurant orders. Clients send item and option ids;
 * every price, total and tax is worked out here from the catalog, so a tampered or stale client
 * cannot change what an order costs.
 */
@Injectable()
export class SuiteOrderService {
  private readonly logger = new Logger(SuiteOrderService.name);

  constructor(
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(OrderService) private readonly orderService: OrderService,
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.ConversationRepository) private readonly customers: ConversationRepository,
    @Inject(TOKENS.SuiteRepository) private readonly repo: SuiteRepository,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  /** Prices lines against the live catalog. Throws 400 with a readable reason on anything invalid. */
  async quote(tenantId: string, input: { lines: OrderLineInput[]; fulfillmentType: string; discount?: DiscountInput; language?: string }): Promise<SuiteQuote> {
    if (!Array.isArray(input.lines) || input.lines.length === 0) throw new BadRequestException("the order has no items");
    if (input.lines.length > MAX_LINES) throw new BadRequestException(`an order can have at most ${MAX_LINES} lines`);
    const settings = await this.orderService.settingsFor(tenantId);
    const language = input.language ?? settings.tenant.defaultLanguage;
    const offerings = new Map<string, Offering>();
    for (const o of await this.catalog.listAllOfferings(tenantId)) offerings.set(o.id, o);

    const lines: PricedLine[] = input.lines.map((line) => {
      const offering = offerings.get(line.offeringId);
      if (!offering || !offering.isActive) throw new BadRequestException(`"${line.offeringId}" is not on the menu any more`);
      const title = localized(offering.name, language, settings.tenant.defaultLanguage);
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) throw new BadRequestException(`quantity of ${title} must be between 1 and ${MAX_QUANTITY}`);
      const chosen = new Set(line.optionIds ?? []);
      const modifiers: CartModifier[] = [];
      for (const group of offering.modifierGroups) {
        const picked = group.options.filter((o) => o.isActive && chosen.has(o.id));
        const groupName = localized(group.name, language, settings.tenant.defaultLanguage);
        if (picked.length < group.minSelect) throw new BadRequestException(`${title}: choose ${group.minSelect === 1 ? "an option" : `${group.minSelect} options`} for ${groupName}`);
        if (picked.length > group.maxSelect) throw new BadRequestException(`${title}: at most ${group.maxSelect} for ${groupName}`);
        for (const o of picked) {
          modifiers.push({ groupId: group.id, optionId: o.id, title: localized(o.name, language, settings.tenant.defaultLanguage), priceDeltaMinor: o.priceDeltaMinor });
          chosen.delete(o.id);
        }
      }
      if (chosen.size > 0) throw new BadRequestException(`${title}: an option that was chosen is no longer available`);
      const unit = offering.priceMinor + modifiers.reduce((n, m) => n + m.priceDeltaMinor, 0);
      const notes = line.notes?.trim().slice(0, 200) || undefined;
      return { offeringId: offering.id, title, quantity: line.quantity, unitPriceMinor: offering.priceMinor, modifiers, lineTotalMinor: unit * line.quantity, notes, categoryId: offering.categoryId, imageUrl: offering.imageUrl };
    });

    const subtotalMinor = lines.reduce((n, l) => n + l.lineTotalMinor, 0);
    const discountMinor = discountOf(subtotalMinor, input.discount);
    const deliveryFeeMinor = input.fulfillmentType === "delivery" ? settings.deliveryFeeMinor : 0;
    const net = subtotalMinor - discountMinor + deliveryFeeMinor;
    const vatMinor = settings.vatInclusive ? vatIncludedIn(net, settings.vatRate) : vatOnTopOf(net, settings.vatRate);
    return { currency: settings.currency, lines, subtotalMinor, discountMinor, deliveryFeeMinor, vatMinor, vatRate: settings.vatRate, vatInclusive: settings.vatInclusive, totalMinor: settings.vatInclusive ? net : net + vatMinor };
  }

  async create(input: CreateSuiteOrderInput): Promise<{ order: Order; branch: Branch; created: boolean }> {
    const branch = await this.suite.branch(input.tenantId, input.branchId);
    if (input.clientRef) {
      const existing = await this.orders.findByClientRef(input.tenantId, input.clientRef);
      if (existing) return { order: existing, branch, created: false };
    }
    const settings = await this.orderService.settingsFor(input.tenantId);
    const q = await this.quote(input.tenantId, { lines: input.lines, fulfillmentType: input.fulfillmentType, discount: input.discount, language: input.language });
    const phone = phoneDigits(input.contactPhone);
    if (input.contactPhone?.trim() && !phone) throw new BadRequestException("that phone number does not look right");
    const name = input.contactName?.trim().slice(0, 80) || undefined;
    const customer = await this.customers.upsertCustomer(input.tenantId, phone ?? WALK_IN_WA_ID, phone ? name : "Walk-in");
    const blueprint = await this.orderService.blueprintFor(input.tenantId);
    const now = new Date();
    const items: OrderItem[] = q.lines.map(({ categoryId, imageUrl: _image, ...line }) => ({ ...line, stationId: stationFor(branch, categoryId), kitchenStatus: "queued" }));

    let raced = false;
    const order = await this.orderService
      .placeThrough(
        input.tenantId,
        (outbox) =>
        this.orders.create(
          {
            tenantId: input.tenantId,
            customerId: customer.id,
            kind: "order",
            initialStatus: blueprint.orderStates.initial,
            fulfillmentType: input.fulfillmentType,
            source: input.source,
            items,
            currency: q.currency,
            subtotalMinor: q.subtotalMinor,
            deliveryFeeMinor: q.deliveryFeeMinor,
            vatMinor: q.vatMinor,
            totalMinor: q.totalMinor,
            paymentStatus: "unpaid",
            paymentMethod: input.paymentMethod ?? settings.paymentMethods[0] ?? "cash",
            deliveryLocation: input.address?.trim() ? { latitude: 0, longitude: 0, address: input.address.trim().slice(0, 300) } : undefined,
            notes: input.notes?.trim().slice(0, 300) || undefined,
            branchId: branch.id,
            tableLabel: input.tableLabel?.trim().slice(0, 30) || undefined,
            contactName: name,
            contactPhone: phone,
            discountMinor: q.discountMinor,
            discountReason: q.discountMinor > 0 ? input.discount?.reason?.trim().slice(0, 120) || undefined : undefined,
            clientRef: input.clientRef,
            publicToken: randomBytes(16).toString("base64url"),
            firedAt: now,
          },
          outbox,
        ),
        { branchId: branch.id, source: input.source },
      )
      .catch(async (err: unknown) => {
        // Two requests with the same clientRef raced; the database let one through. Hand back the winner.
        const winner = input.clientRef ? await this.orders.findByClientRef(input.tenantId, input.clientRef) : null;
        if (!winner) throw err;
        raced = true;
        return winner;
      });
    if (raced) return { order, branch, created: false };
    this.logger.log(`${input.source} order #${order.number} at ${branch.name}: ${order.items.length} line(s), ${order.totalMinor} ${order.currency}${input.actor ? ` by ${input.actor}` : ""}`);
    return { order, branch, created: true };
  }

  /** Records money against an order and marks it paid once the payments cover the total. */
  async pay(tenantId: string, orderId: string, input: { method: PaymentMethod; amountMinor?: number; tenderedMinor?: number; reference?: string; actor?: string }): Promise<{ order: Order; payment: OrderPaymentRecord; paidMinor: number; dueMinor: number }> {
    const order = await this.orders.findById(tenantId, orderId);
    if (!order) throw new NotFoundException("order not found");
    const before = (await this.repo.listPayments(tenantId, { orderId })).reduce((n, p) => n + p.amountMinor, 0);
    const due = Math.max(0, order.totalMinor - before);
    if (due === 0) throw new BadRequestException("this order is already paid");
    const amount = input.amountMinor ?? due;
    if (!Number.isInteger(amount) || amount <= 0 || amount > due) throw new BadRequestException("the amount must be more than zero and no more than what is due");
    let tendered: number | undefined;
    let change: number | undefined;
    if (input.method === "cash" && input.tenderedMinor !== undefined) {
      if (!Number.isInteger(input.tenderedMinor) || input.tenderedMinor < amount) throw new BadRequestException("the cash handed over is less than the amount");
      tendered = input.tenderedMinor;
      change = tendered - amount;
    }
    const payment = await this.repo.addPayment({ tenantId, orderId, branchId: order.branchId, method: input.method, amountMinor: amount, tenderedMinor: tendered, changeMinor: change, reference: input.reference?.trim().slice(0, 80) || undefined, createdBy: input.actor });
    const paidMinor = before + amount;
    const updated = await this.orders.patch(tenantId, orderId, { paymentStatus: paidMinor >= order.totalMinor ? "paid" : "pending", paymentMethod: input.method });
    this.hub.emit(tenantId, { type: "order.paid", orderId, branchId: order.branchId });
    return { order: updated, payment, paidMinor, dueMinor: Math.max(0, order.totalMinor - paidMinor) };
  }
}

export function discountOf(subtotalMinor: number, discount: DiscountInput | undefined): number {
  if (!discount || !Number.isFinite(discount.value) || discount.value <= 0) return 0;
  const raw = discount.type === "percent" ? Math.round((subtotalMinor * Math.min(discount.value, 100)) / 100) : Math.round(discount.value);
  return Math.max(0, Math.min(raw, subtotalMinor));
}

/** The station that lists the item's category, else the branch's first station. */
export function stationFor(branch: Pick<Branch, "stations">, categoryId: string | undefined): string | undefined {
  const match = categoryId ? branch.stations.find((s) => s.categoryIds.includes(categoryId)) : undefined;
  return (match ?? branch.stations[0])?.id;
}
