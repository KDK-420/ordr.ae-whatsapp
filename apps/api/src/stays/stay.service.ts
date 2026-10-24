import { Inject, Injectable } from "@nestjs/common";
import { addDays, addItem, canTransition, emptyCart, freeUnits, isTerminal, localDateKey, localized, nightsBetween, type Offering, type Order, type Property, quote as buildQuote, SlotTakenError, type StateMachine, zonedToUtc } from "@ordr/domain";
import type { AppConfig } from "../config";
import { OrderService } from "../orders/order.service";
import type { BlueprintRegistry, BookingHoldRecord, BookingHoldRepository, CatalogRepository, OrderRepository, PropertyRepository, StayRepository } from "../ports";
import { TOKENS } from "../tokens";

export class StayError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_dates" | "too_many_guests" | "no_availability" | "not_allowed" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "StayError";
  }
}

export interface StaySettings {
  tz: string;
  currency: string;
  vatRate: number;
  vatInclusive: boolean;
  maxNights: number;
  maxAdvanceDays: number;
  blocking: string[];
  machine: StateMachine;
  defaultLanguage: string;
  paymentMethod: string;
}

/** Dates in the tenant zone, YYYY-MM-DD. */
export interface StayDates {
  checkIn: string;
  checkOut: string;
}

export interface StayQuote {
  nights: number;
  nightlyMinor: number;
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  currency: string;
}

export interface StayOption {
  offering: Offering;
  property: Property;
  /** Free units over the whole range (0 when some night is full). */
  available: number;
  quote: StayQuote;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stays for resort tenants: one WhatsApp number, one or many properties, room types with a number
 * of identical units priced per night. Availability is per night; a stay or hold occupies one unit
 * from check-in to check-out. Writes go through StayRepository under the room type's lock.
 */
@Injectable()
export class StayService {
  /** Overridable clock so tests can pin "today". */
  now: () => Date = () => new Date();

  constructor(
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.PropertyRepository) private readonly properties: PropertyRepository,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.BookingHoldRepository) private readonly holds: BookingHoldRepository,
    @Inject(TOKENS.StayRepository) private readonly stays: StayRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(OrderService) private readonly orderService: OrderService,
    @Inject(TOKENS.Config) private readonly config: AppConfig,
  ) {}

  async settings(tenantId: string): Promise<StaySettings> {
    const s = await this.orderService.settingsFor(tenantId);
    const blueprint = this.blueprints.get(s.tenant.blueprintId);
    if (!blueprint) throw new StayError("unavailable", `blueprint ${s.tenant.blueprintId} not found`);
    const cfg = { maxNights: 30, maxAdvanceDays: 365, ...(blueprint.settings as Record<string, unknown>), ...(s.tenant.settings as Record<string, unknown>) } as Record<string, number>;
    return {
      tz: s.tenant.timezone || "Asia/Dubai",
      currency: s.currency,
      vatRate: s.vatRate,
      vatInclusive: s.vatInclusive,
      maxNights: cfg.maxNights!,
      maxAdvanceDays: cfg.maxAdvanceDays!,
      blocking: blueprint.orderStates.states.filter((st) => !isTerminal(blueprint.orderStates, st)),
      machine: blueprint.orderStates,
      defaultLanguage: s.tenant.defaultLanguage,
      paymentMethod: s.paymentMethods[0] ?? "at_property",
    };
  }

  /** Active properties in display order. One for a single resort, several for a group. */
  listProperties(tenantId: string): Promise<Property[]> {
    return this.properties.list(tenantId);
  }

  async property(tenantId: string, propertyId: string): Promise<Property> {
    const p = await this.properties.get(tenantId, propertyId);
    if (!p || !p.isActive) throw new StayError("not_found", "no such resort");
    return p;
  }

  /** Active room types, optionally of one property, in catalog order. */
  async roomTypes(tenantId: string, propertyId?: string): Promise<Offering[]> {
    const all = await this.catalog.listAllOfferings(tenantId);
    return all.filter((o) => o.isActive && o.type === "stay" && (!propertyId || o.propertyId === propertyId));
  }

  async roomType(tenantId: string, offeringId: string): Promise<Offering> {
    const o = await this.catalog.getOffering(tenantId, offeringId);
    if (!o || !o.isActive || o.type !== "stay") throw new StayError("not_found", "no such room type");
    return o;
  }

  /** Checks the dates against today, the booking horizon and the longest stay allowed. */
  validateDates(settings: StaySettings, dates: StayDates): string[] {
    if (!DATE_RE.test(dates.checkIn) || !DATE_RE.test(dates.checkOut)) throw new StayError("invalid_dates", "dates must be YYYY-MM-DD");
    const nights = nightsBetween(dates.checkIn, dates.checkOut);
    if (nights.length === 0) throw new StayError("invalid_dates", "check-out must be after check-in");
    const today = localDateKey(this.now(), settings.tz);
    if (dates.checkIn < today) throw new StayError("invalid_dates", `check-in cannot be in the past (today is ${today})`);
    if (dates.checkIn > addDays(today, settings.maxAdvanceDays)) throw new StayError("invalid_dates", `bookings open up to ${settings.maxAdvanceDays} days ahead`);
    if (nights.length > settings.maxNights) throw new StayError("invalid_dates", `stays are limited to ${settings.maxNights} nights`);
    return nights;
  }

  /** Check-in and check-out instants and the start of every night, from the property's times. */
  range(settings: StaySettings, property: Property, dates: StayDates): { startAt: Date; endAt: Date; nightStarts: Date[] } {
    const nights = nightsBetween(dates.checkIn, dates.checkOut);
    return {
      startAt: zonedToUtc(dates.checkIn, property.checkInTime, settings.tz),
      endAt: zonedToUtc(dates.checkOut, property.checkOutTime, settings.tz),
      nightStarts: nights.map((d) => zonedToUtc(d, property.checkInTime, settings.tz)),
    };
  }

  quote(settings: StaySettings, offering: Offering, nights: number): StayQuote {
    const cart = addItem(emptyCart(offering.currency), { offeringId: offering.id, title: "stay", quantity: nights, unitPriceMinor: offering.priceMinor, modifiers: [] });
    const q = buildQuote(cart, { fulfillmentType: "stay", deliveryFeeMinor: 0, vatRate: settings.vatRate, vatInclusive: settings.vatInclusive });
    return { nights, nightlyMinor: offering.priceMinor, subtotalMinor: q.subtotalMinor, vatMinor: q.vatMinor, totalMinor: q.totalMinor, currency: q.currency };
  }

  /** Free units for one room type over the dates, counting the customer's own live holds as free. */
  async available(tenantId: string, offering: Offering, property: Property, dates: StayDates, opts: { settings?: StaySettings; forCustomerId?: string; exceptHoldId?: string } = {}): Promise<number> {
    const settings = opts.settings ?? (await this.settings(tenantId));
    const { startAt, endAt, nightStarts } = this.range(settings, property, dates);
    const occ = await this.stays.occupancy(tenantId, offering.id, startAt, endAt, settings.blocking, this.now());
    const taken = [...occ.stays, ...occ.holds.filter((h) => h.id !== opts.exceptHoldId && (!opts.forCustomerId || h.customerId !== opts.forCustomerId))];
    return Math.max(0, freeUnits(offering.units ?? 1, { startAt, endAt }, taken, nightStarts));
  }

  /**
   * Every room type that fits the party, across all properties or one, with availability and
   * the total for the stay. Sold-out room types come back with available 0 so the agent can say so.
   */
  async search(tenantId: string, input: StayDates & { guests: number; propertyId?: string; forCustomerId?: string }): Promise<StayOption[]> {
    const settings = await this.settings(tenantId);
    const nights = this.validateDates(settings, input);
    const [rooms, properties] = await Promise.all([this.roomTypes(tenantId, input.propertyId), this.listProperties(tenantId)]);
    const byId = new Map(properties.map((p) => [p.id, p]));
    const out: StayOption[] = [];
    for (const offering of rooms) {
      const property = offering.propertyId ? byId.get(offering.propertyId) : undefined;
      if (!property || (offering.maxGuests ?? 2) < input.guests) continue;
      const available = await this.available(tenantId, offering, property, input, { settings, forCustomerId: input.forCustomerId });
      out.push({ offering, property, available, quote: this.quote(settings, offering, nights.length) });
    }
    return out;
  }

  /** Reserves one unit for a few minutes while the customer confirms. Throws no_availability when a night is full. */
  async hold(input: StayDates & { tenantId: string; customerId: string; conversationId?: string; offeringId: string; guests: number }): Promise<{ hold: BookingHoldRecord; offering: Offering; property: Property; quote: StayQuote; settings: StaySettings }> {
    const settings = await this.settings(input.tenantId);
    const nights = this.validateDates(settings, input);
    const offering = await this.roomType(input.tenantId, input.offeringId);
    const property = await this.property(input.tenantId, offering.propertyId ?? "");
    if (input.guests > (offering.maxGuests ?? 2)) throw new StayError("too_many_guests", `${localized(offering.name, settings.defaultLanguage)} sleeps at most ${offering.maxGuests ?? 2}`);
    const { startAt, endAt, nightStarts } = this.range(settings, property, input);
    // A customer re-holding (other dates, other room) replaces their earlier live holds here.
    const own = await this.holds.activeInRange(input.tenantId, new Date(0), new Date(8640000000000000), this.now());
    for (const h of own) if (h.customerId === input.customerId && h.resourceId === h.offeringId) await this.holds.setStatus(h.id, "released");
    try {
      const hold = await this.stays.createHold(
        { tenantId: input.tenantId, customerId: input.customerId, conversationId: input.conversationId, offeringId: offering.id, resourceId: offering.id, startAt, endAt, expiresAt: new Date(this.now().getTime() + this.config.HOLD_MINUTES * 60_000) },
        settings.blocking,
        offering.units ?? 1,
        nightStarts,
        this.now(),
      );
      return { hold, offering, property, quote: this.quote(settings, offering, nights.length), settings };
    } catch (err) {
      if (err instanceof SlotTakenError) throw new StayError("no_availability", "no room of that type is free for all of those nights");
      throw err;
    }
  }

  async releaseHold(tenantId: string, customerId: string, holdId: string): Promise<void> {
    const hold = await this.holds.findById(tenantId, holdId);
    if (hold && hold.customerId === customerId && hold.status === "held") await this.holds.setStatus(holdId, "released");
  }

  /** Turns the customer's own live hold into a stay order. */
  async confirmHold(input: { tenantId: string; customerId: string; holdId: string; guests: number; guestName?: string; notes?: string; language: string; source?: Order["source"] }): Promise<{ order: Order; offering: Offering; property: Property; settings: StaySettings }> {
    const settings = await this.settings(input.tenantId);
    const hold = await this.holds.findById(input.tenantId, input.holdId);
    if (!hold || hold.customerId !== input.customerId) throw new StayError("not_found", "no such hold");
    if (hold.status !== "held" || new Date(hold.expiresAt) <= this.now()) throw new StayError("no_availability", "the hold has expired; check availability again");
    const offering = await this.roomType(input.tenantId, hold.offeringId);
    const property = await this.property(input.tenantId, offering.propertyId ?? "");
    if (input.guests > (offering.maxGuests ?? 2)) throw new StayError("too_many_guests", `that room sleeps at most ${offering.maxGuests ?? 2}`);
    const startAt = new Date(hold.startAt);
    const endAt = new Date(hold.endAt);
    const dates = { checkIn: localDateKey(startAt, settings.tz), checkOut: localDateKey(endAt, settings.tz) };
    const nights = nightsBetween(dates.checkIn, dates.checkOut);
    const { nightStarts } = this.range(settings, property, dates);
    const q = this.quote(settings, offering, nights.length);
    const title = `${localized(offering.name, input.language, settings.defaultLanguage)} · ${localized(property.name, input.language, settings.defaultLanguage)}`;
    const notes = [input.guestName ? `Guest: ${input.guestName}` : null, input.notes?.trim() || null].filter(Boolean).join("\n") || undefined;
    try {
      const order = await this.orderService.placeThrough(
        input.tenantId,
        (outbox) =>
          this.stays.createStay(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              conversationId: hold.conversationId,
              kind: "stay",
              initialStatus: settings.machine.initial,
              fulfillmentType: "stay",
              source: input.source ?? "whatsapp",
              items: [{ offeringId: offering.id, title, quantity: nights.length, unitPriceMinor: offering.priceMinor, modifiers: [], lineTotalMinor: offering.priceMinor * nights.length }],
              currency: q.currency,
              subtotalMinor: q.subtotalMinor,
              deliveryFeeMinor: 0,
              vatMinor: q.vatMinor,
              totalMinor: q.totalMinor,
              paymentStatus: "unpaid",
              paymentMethod: settings.paymentMethod,
              notes,
              scheduledAt: startAt,
              checkOutAt: endAt,
              guests: input.guests,
              propertyId: property.id,
              holdId: hold.id,
            },
            settings.blocking,
            offering.units ?? 1,
            nightStarts,
            this.now(),
            outbox,
          ),
        { checkOutAt: endAt.toISOString(), propertyId: property.id, guests: input.guests },
      );
      return { order, offering, property, settings };
    } catch (err) {
      if (err instanceof SlotTakenError) throw new StayError("no_availability", "that room was just taken for those nights");
      throw err;
    }
  }

  /** The customer's stays that have not ended, soonest first. */
  async upcoming(tenantId: string, customerId: string): Promise<Order[]> {
    const settings = await this.settings(tenantId);
    const rows = await this.orders.listRecent(tenantId, { customerId, statuses: settings.blocking, limit: 50 });
    const now = this.now().getTime();
    return rows
      .filter((o) => o.kind === "stay" && o.checkOutAt && new Date(o.checkOutAt).getTime() > now)
      .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  }

  /** Cancels the customer's own stay when the state machine allows it. */
  async cancel(tenantId: string, customerId: string, orderId: string): Promise<Order> {
    const settings = await this.settings(tenantId);
    const order = await this.orders.findById(tenantId, orderId);
    if (!order || order.customerId !== customerId || order.kind !== "stay") throw new StayError("not_found", "stay not found");
    if (!canTransition(settings.machine, order.status, "cancel")) throw new StayError("not_allowed", `a ${order.status} stay cannot be cancelled here`);
    return this.orderService.transition(tenantId, orderId, "cancel", `customer:${customerId}`);
  }
}
