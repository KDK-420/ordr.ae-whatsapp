import { Inject, Injectable } from "@nestjs/common";
import {
  addDays,
  type Busy,
  canServe,
  canTransition,
  generateSlots,
  hoursOn,
  isTerminal,
  localDateKey,
  localized,
  type Offering,
  type Order,
  type Resource,
  SlotTakenError,
  type StateMachine,
  tzOffsetMinutes,
  zonedToUtc,
} from "@ordr/domain";
import { OrderService } from "../orders/order.service";
import type { AppConfig } from "../config";
import type { BlueprintRegistry, BookingHoldRecord, BookingHoldRepository, CatalogRepository, OrderRepository, ResourceRepository } from "../ports";
import { TOKENS } from "../tokens";

/** Pseudo resource id meaning "whoever is free". */
export const ANY_RESOURCE = "any";

export type Period = "morning" | "afternoon" | "evening";
/** Local start hour ranges, end exclusive. */
const PERIODS: Record<Period, [number, number]> = { morning: [0, 12], afternoon: [12, 17], evening: [17, 24] };

export interface SchedulingSettings {
  tz: string;
  slotStepMinutes: number;
  bufferMinutes: number;
  leadMinutes: number;
  maxAdvanceDays: number;
  /** Statuses that occupy a resource's time. */
  blocking: string[];
  machine: StateMachine;
  defaultLanguage: string;
  fulfillmentType: string;
}

export interface Slot {
  startAt: Date;
  resource: Resource;
}

/** What is already taken in a window, loaded once for every resource. */
interface Occupied {
  bookings: Order[];
  holds: BookingHoldRecord[];
}

export class BookingError extends Error {
  constructor(
    public readonly code: "slot_taken" | "not_found" | "not_allowed" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

@Injectable()
export class SchedulingService {
  /** Overridable clock so tests and demos can pin "now". */
  now: () => Date = () => new Date();

  constructor(
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.ResourceRepository) private readonly resources: ResourceRepository,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(OrderService) private readonly orderService: OrderService,
    @Inject(TOKENS.BookingHoldRepository) private readonly holds: BookingHoldRepository,
    @Inject(TOKENS.Config) private readonly config: AppConfig,
  ) {}

  /**
   * Reserves a free slot for the customer while they confirm (ADR 0002). Picks the first free
   * person when `resourceId` is "any". Throws slot_taken when nothing is free at that time.
   */
  async hold(input: { tenantId: string; customerId: string; conversationId?: string; offeringId: string; resourceId: string; startAt: Date }): Promise<{ hold: BookingHoldRecord; offering: Offering; resource: Resource; settings: SchedulingSettings }> {
    const settings = await this.settings(input.tenantId);
    const offering = await this.service(input.tenantId, input.offeringId);
    const date = localDateKey(input.startAt, settings.tz);
    const free = await this.slotsOn(settings, offering, await this.candidates(input.tenantId, input.offeringId, input.resourceId), date, { forCustomerId: input.customerId });
    const match = free.find((s) => s.startAt.getTime() === input.startAt.getTime());
    if (!match) throw new BookingError("slot_taken", "that time is not available");
    const duration = offering.durationMinutes ?? settings.slotStepMinutes;
    const endAt = new Date(input.startAt.getTime() + (duration + settings.bufferMinutes) * 60_000);
    // A customer re-holding the same time (or changing their mind) replaces their earlier hold.
    for (const own of await this.holds.activeOverlapping(input.tenantId, match.resource.id, input.startAt, endAt, this.now())) {
      if (own.customerId === input.customerId) await this.holds.setStatus(own.id, "released");
    }
    try {
      const hold = await this.holds.create(
        { tenantId: input.tenantId, customerId: input.customerId, conversationId: input.conversationId, offeringId: offering.id, resourceId: match.resource.id, startAt: input.startAt, endAt, expiresAt: new Date(this.now().getTime() + this.config.HOLD_MINUTES * 60_000) },
        settings.blocking,
      );
      return { hold, offering, resource: match.resource, settings };
    } catch (err) {
      if (err instanceof SlotTakenError) throw new BookingError("slot_taken", "that time was just taken");
      throw err;
    }
  }

  /** Turns the customer's own live hold into a booking. */
  async confirmHold(input: { tenantId: string; customerId: string; holdId: string; language: string; notes?: string; source?: Order["source"] }): Promise<{ order: Order; offering: Offering; resource: Resource; settings: SchedulingSettings }> {
    const settings = await this.settings(input.tenantId);
    const hold = await this.holds.findById(input.tenantId, input.holdId);
    if (!hold || hold.customerId !== input.customerId) throw new BookingError("not_found", "no such hold");
    if (hold.status !== "held" || new Date(hold.expiresAt) <= this.now()) throw new BookingError("slot_taken", "the hold has expired; check the time again");
    const offering = await this.service(input.tenantId, hold.offeringId);
    const resource = await this.resources.get(input.tenantId, hold.resourceId);
    if (!resource) throw new BookingError("unavailable", "that team member is no longer available");
    try {
      const order = await this.orderService.placeBooking({
        tenantId: input.tenantId,
        customerId: input.customerId,
        conversationId: hold.conversationId,
        offering,
        title: localized(offering.name, input.language, settings.defaultLanguage),
        resourceId: hold.resourceId,
        startAt: new Date(hold.startAt),
        durationMinutes: offering.durationMinutes ?? settings.slotStepMinutes,
        fulfillmentType: settings.fulfillmentType,
        blockingStatuses: settings.blocking,
        notes: input.notes,
        source: input.source,
        holdId: hold.id,
      });
      return { order, offering, resource, settings };
    } catch (err) {
      if (err instanceof SlotTakenError) throw new BookingError("slot_taken", "that time was just taken");
      throw err;
    }
  }

  /** Marks lapsed holds expired. The overlap checks already ignore them; this keeps the table tidy. Run by the worker. */
  expireHolds(now = this.now()): Promise<number> {
    return this.holds.expire(now);
  }

  async releaseHold(tenantId: string, customerId: string, holdId: string): Promise<void> {
    const hold = await this.holds.findById(tenantId, holdId);
    if (hold && hold.customerId === customerId && hold.status === "held") await this.holds.setStatus(holdId, "released");
  }

  /** Moves the customer's own booking to a free time, atomically against other bookings and holds. */
  async reschedule(input: { tenantId: string; customerId: string; orderId: string; resourceId: string; startAt: Date }): Promise<{ order: Order; resource: Resource; settings: SchedulingSettings }> {
    const settings = await this.settings(input.tenantId);
    const order = await this.orders.findById(input.tenantId, input.orderId);
    if (!order || order.customerId !== input.customerId || order.kind !== "booking") throw new BookingError("not_found", "booking not found");
    if (!settings.blocking.includes(order.status) || !canTransition(settings.machine, order.status, "cancel")) throw new BookingError("not_allowed", `a ${order.status} booking cannot be moved here`);
    const offeringId = order.items[0]?.offeringId;
    if (!offeringId) throw new BookingError("unavailable", "booking has no service");
    const date = localDateKey(input.startAt, settings.tz);
    // The booking's own slot is busy in the slot list; a move to a different time must be free.
    const free = await this.slots(input.tenantId, offeringId, input.resourceId, date, { forCustomerId: input.customerId });
    const match = free.find((s) => s.startAt.getTime() === input.startAt.getTime());
    if (!match) throw new BookingError("slot_taken", "that time is not available");
    try {
      const moved = await this.orderService.rescheduleBooking(input.tenantId, order.id, { startAt: input.startAt, resourceId: match.resource.id, durationMinutes: order.durationMinutes ?? settings.slotStepMinutes, blockingStatuses: settings.blocking, actor: `customer:${input.customerId}` });
      return { order: moved, resource: match.resource, settings };
    } catch (err) {
      if (err instanceof SlotTakenError) throw new BookingError("slot_taken", "that time was just taken");
      throw err;
    }
  }

  async settings(tenantId: string): Promise<SchedulingSettings> {
    const s = await this.orderService.settingsFor(tenantId);
    const blueprint = this.blueprints.get(s.tenant.blueprintId);
    if (!blueprint) throw new BookingError("unavailable", `blueprint ${s.tenant.blueprintId} not found`);
    const cfg = { slotStepMinutes: 30, bufferMinutes: 0, leadMinutes: 60, maxAdvanceDays: 14, ...(blueprint.settings as Record<string, unknown>), ...(s.tenant.settings as Record<string, unknown>) } as Record<string, number>;
    return {
      tz: s.tenant.timezone || "Asia/Dubai",
      slotStepMinutes: cfg.slotStepMinutes!,
      bufferMinutes: cfg.bufferMinutes!,
      leadMinutes: cfg.leadMinutes!,
      maxAdvanceDays: cfg.maxAdvanceDays!,
      blocking: blueprint.orderStates.states.filter((st) => !isTerminal(blueprint.orderStates, st)),
      machine: blueprint.orderStates,
      defaultLanguage: s.tenant.defaultLanguage,
      fulfillmentType: blueprint.fulfillmentTypes[0] ?? "in_store",
    };
  }

  /** Bookable services, in catalog order. */
  async services(tenantId: string): Promise<Offering[]> {
    const all = await this.catalog.listAllOfferings(tenantId);
    return all.filter((o) => o.isActive);
  }

  async service(tenantId: string, offeringId: string): Promise<Offering> {
    const o = await this.catalog.getOffering(tenantId, offeringId);
    if (!o || !o.isActive) throw new BookingError("unavailable", "that service is not available");
    return o;
  }

  /** Active resources able to perform the service. */
  async staffFor(tenantId: string, offeringId: string): Promise<Resource[]> {
    return (await this.resources.list(tenantId)).filter((r) => canServe(r, offeringId));
  }

  resource(tenantId: string, resourceId: string): Promise<Resource | null> {
    return this.resources.get(tenantId, resourceId);
  }

  /** The next `count` calendar days (tenant zone) with at least one free slot. */
  async availableDays(tenantId: string, offeringId: string, resourceId: string, opts: { count?: number; forCustomerId?: string } = {}): Promise<string[]> {
    const settings = await this.settings(tenantId);
    const offering = await this.service(tenantId, offeringId);
    const candidates = await this.candidates(tenantId, offeringId, resourceId);
    const now = this.now();
    const today = localDateKey(now, settings.tz);
    // Everything that occupies the whole window is read once (two queries), not twice per day per person.
    const lastDay = addDays(today, settings.maxAdvanceDays + 1);
    const occupied = await this.occupied(settings, offering.tenantId, zonedToUtc(today, "00:00", settings.tz), zonedToUtc(lastDay, "00:00", settings.tz), now);
    const out: string[] = [];
    for (let d = 0; d <= settings.maxAdvanceDays && out.length < (opts.count ?? 7); d++) {
      const date = addDays(today, d);
      const slots = this.slotsFor(settings, offering, candidates, date, now, occupied, opts.forCustomerId);
      if (slots.length > 0) out.push(date);
    }
    return out;
  }

  /** Free slots on a day for the service, with the resource that would take each one. */
  async slots(tenantId: string, offeringId: string, resourceId: string, date: string, opts: { period?: Period; forCustomerId?: string } = {}): Promise<Slot[]> {
    const settings = await this.settings(tenantId);
    const offering = await this.service(tenantId, offeringId);
    return this.slotsOn(settings, offering, await this.candidates(tenantId, offeringId, resourceId), date, opts);
  }

  /** `slots` with everything already looked up. */
  private async slotsOn(settings: SchedulingSettings, offering: Offering, candidates: Resource[], date: string, opts: { period?: Period; forCustomerId?: string } = {}): Promise<Slot[]> {
    const now = this.now();
    const occupied = await this.occupied(settings, offering.tenantId, zonedToUtc(date, "00:00", settings.tz), new Date(zonedToUtc(addDays(date, 1), "00:00", settings.tz).getTime() + 6 * 60 * 60_000), now);
    const all = this.slotsFor(settings, offering, candidates, date, now, occupied, opts.forCustomerId);
    if (!opts.period) return all;
    const [from, to] = PERIODS[opts.period];
    return all.filter((s) => {
      const hour = Math.floor(((s.startAt.getTime() + tzOffsetMinutes(settings.tz, s.startAt) * 60_000) / 3_600_000) % 24);
      return hour >= from && hour < to;
    });
  }

  /** Books the slot if it is still free. `resourceId` may be ANY_RESOURCE. */
  async book(input: {
    tenantId: string;
    customerId: string;
    conversationId?: string;
    offeringId: string;
    resourceId: string;
    startAt: Date;
    language: string;
    notes?: string;
  }): Promise<{ order: Order; offering: Offering; resource: Resource; settings: SchedulingSettings }> {
    const settings = await this.settings(input.tenantId);
    const offering = await this.service(input.tenantId, input.offeringId);
    const date = localDateKey(input.startAt, settings.tz);
    const free = await this.slotsOn(settings, offering, await this.candidates(input.tenantId, input.offeringId, input.resourceId), date);
    const match = free.find((s) => s.startAt.getTime() === input.startAt.getTime());
    if (!match) throw new BookingError("slot_taken", "that time is no longer available");
    try {
      const order = await this.orderService.placeBooking({
        tenantId: input.tenantId,
        customerId: input.customerId,
        conversationId: input.conversationId,
        offering,
        title: localized(offering.name, input.language, settings.defaultLanguage),
        resourceId: match.resource.id,
        startAt: input.startAt,
        durationMinutes: offering.durationMinutes ?? settings.slotStepMinutes,
        fulfillmentType: settings.fulfillmentType,
        blockingStatuses: settings.blocking,
        notes: input.notes,
      });
      return { order, offering, resource: match.resource, settings };
    } catch (err) {
      if (err instanceof SlotTakenError) throw new BookingError("slot_taken", "that time was just taken");
      throw err;
    }
  }

  /** The customer's bookings from now on that still occupy time, soonest first. */
  async upcoming(tenantId: string, customerId: string): Promise<Order[]> {
    const settings = await this.settings(tenantId);
    const now = this.now();
    const rows = await this.orders.listBookings(tenantId, { from: new Date(now.getTime() - 60 * 60_000), to: new Date(now.getTime() + 90 * 24 * 60 * 60_000), statuses: settings.blocking });
    return rows.filter((o) => o.customerId === customerId);
  }

  /** Cancels a customer's own booking when the state machine allows it. */
  async cancel(tenantId: string, customerId: string, orderId: string): Promise<Order> {
    const settings = await this.settings(tenantId);
    const order = await this.orders.findById(tenantId, orderId);
    if (!order || order.customerId !== customerId) throw new BookingError("not_found", "booking not found");
    if (!canTransition(settings.machine, order.status, "cancel")) throw new BookingError("not_allowed", `a ${order.status} booking cannot be cancelled here`);
    return this.orderService.transition(tenantId, orderId, "cancel", `customer:${customerId}`);
  }

  private async candidates(tenantId: string, offeringId: string, resourceId: string): Promise<Resource[]> {
    if (resourceId === ANY_RESOURCE) return this.staffFor(tenantId, offeringId);
    const r = await this.resources.get(tenantId, resourceId);
    return r && canServe(r, offeringId) ? [r] : [];
  }

  /** Bookings in blocking statuses and live holds for every resource of the tenant in [from, to), with a margin for appointments that started earlier. */
  private async occupied(settings: SchedulingSettings, tenantId: string, from: Date, to: Date, now: Date): Promise<Occupied> {
    const margin = 6 * 60 * 60_000;
    const [bookings, holds] = await Promise.all([
      this.orders.listBookings(tenantId, { from: new Date(from.getTime() - margin), to: new Date(to.getTime() + margin), statuses: settings.blocking }),
      this.holds.activeInRange(tenantId, new Date(from.getTime() - margin), new Date(to.getTime() + margin), now),
    ]);
    return { bookings: bookings.filter((b) => b.resourceId), holds };
  }

  /** Free slots on one day: working hours minus bookings in blocking statuses minus other customers' live holds. */
  private slotsFor(settings: SchedulingSettings, offering: Offering, candidates: Resource[], date: string, now: Date, occupied: Occupied, forCustomerId?: string): Slot[] {
    const duration = offering.durationMinutes ?? settings.slotStepMinutes;
    const dayStart = zonedToUtc(date, "00:00", settings.tz).getTime() - 6 * 60 * 60_000;
    const dayEnd = zonedToUtc(addDays(date, 1), "00:00", settings.tz).getTime() + 6 * 60 * 60_000;
    const byStart = new Map<number, Slot>();
    for (const resource of [...candidates].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const hours = hoursOn(resource.hours, date);
      if (hours.length === 0) continue;
      const busy: Busy[] = [];
      for (const b of occupied.bookings) {
        if (b.resourceId !== resource.id || !b.scheduledAt) continue;
        const start = new Date(b.scheduledAt);
        const end = new Date(start.getTime() + (b.durationMinutes ?? duration) * 60_000);
        if (end.getTime() <= dayStart || start.getTime() >= dayEnd) continue;
        busy.push({ start, end });
      }
      for (const h of occupied.holds) {
        if (h.resourceId !== resource.id || (forCustomerId && h.customerId === forCustomerId)) continue;
        const start = new Date(h.startAt);
        if (new Date(h.endAt).getTime() <= dayStart || start.getTime() >= dayEnd) continue;
        // A hold already includes the buffer in its end time; generateSlots adds the buffer again, so take it back out.
        busy.push({ start, end: new Date(new Date(h.endAt).getTime() - settings.bufferMinutes * 60_000) });
      }
      for (const startAt of generateSlots({ date, tz: settings.tz, hours, stepMinutes: settings.slotStepMinutes, durationMinutes: duration, bufferMinutes: settings.bufferMinutes, busy, now, leadMinutes: settings.leadMinutes })) {
        if (!byStart.has(startAt.getTime())) byStart.set(startAt.getTime(), { startAt, resource });
      }
    }
    return [...byStart.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }
}
