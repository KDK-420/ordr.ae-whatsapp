import { Inject, Injectable } from "@nestjs/common";
import {
  addDays,
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
import type { BlueprintRegistry, CatalogRepository, OrderRepository, ResourceRepository } from "../ports";
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
  ) {}

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
  async availableDays(tenantId: string, offeringId: string, resourceId: string, opts: { count?: number } = {}): Promise<string[]> {
    const settings = await this.settings(tenantId);
    const offering = await this.service(tenantId, offeringId);
    const candidates = await this.candidates(tenantId, offeringId, resourceId);
    const now = this.now();
    const today = localDateKey(now, settings.tz);
    const out: string[] = [];
    for (let d = 0; d <= settings.maxAdvanceDays && out.length < (opts.count ?? 7); d++) {
      const date = addDays(today, d);
      const slots = await this.slotsFor(settings, offering, candidates, date, now);
      if (slots.length > 0) out.push(date);
    }
    return out;
  }

  /** Free slots on a day for the service, with the resource that would take each one. */
  async slots(tenantId: string, offeringId: string, resourceId: string, date: string, opts: { period?: Period } = {}): Promise<Slot[]> {
    const settings = await this.settings(tenantId);
    const offering = await this.service(tenantId, offeringId);
    const candidates = await this.candidates(tenantId, offeringId, resourceId);
    const all = await this.slotsFor(settings, offering, candidates, date, this.now());
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
    const free = await this.slots(input.tenantId, input.offeringId, input.resourceId, date);
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

  private async slotsFor(settings: SchedulingSettings, offering: Offering, candidates: Resource[], date: string, now: Date): Promise<Slot[]> {
    const duration = offering.durationMinutes ?? settings.slotStepMinutes;
    const dayStart = zonedToUtc(date, "00:00", settings.tz);
    const dayEnd = new Date(zonedToUtc(addDays(date, 1), "00:00", settings.tz).getTime() + 6 * 60 * 60_000);
    const byStart = new Map<number, Slot>();
    for (const resource of [...candidates].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const hours = hoursOn(resource.hours, date);
      if (hours.length === 0) continue;
      const bookings = await this.orders.listBookings(offering.tenantId, { from: new Date(dayStart.getTime() - 6 * 60 * 60_000), to: dayEnd, resourceId: resource.id, statuses: settings.blocking });
      const busy = bookings.map((b) => {
        const start = new Date(b.scheduledAt!);
        return { start, end: new Date(start.getTime() + (b.durationMinutes ?? duration) * 60_000) };
      });
      for (const startAt of generateSlots({ date, tz: settings.tz, hours, stepMinutes: settings.slotStepMinutes, durationMinutes: duration, bufferMinutes: settings.bufferMinutes, busy, now, leadMinutes: settings.leadMinutes })) {
        if (!byStart.has(startAt.getTime())) byStart.set(startAt.getTime(), { startAt, resource });
      }
    }
    return [...byStart.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }
}
