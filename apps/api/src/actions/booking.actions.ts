import { formatMoney, localized } from "@ordr/domain";
import type { DynamicRow, MapActionRegistry } from "@ordr/flow-schema";
import { formatDay, formatTime, formatWhen } from "../scheduling/format";
import { ANY_RESOURCE, BookingError, type Period, SchedulingService } from "../scheduling/scheduling.service";
import { COPY, statusLabel, t } from "./copy";

const PERIODS: Period[] = ["morning", "afternoon", "evening"];

/** Slot row ids carry everything booking.create needs: "<ISO start>|<resource id>". */
const slotId = (startAt: Date, resourceId: string) => `${startAt.toISOString()}|${resourceId}`;
const parseSlotId = (id: string): { startAt: Date; resourceId: string } => {
  const [iso, resourceId] = id.split("|");
  const startAt = new Date(iso ?? "");
  if (Number.isNaN(startAt.getTime()) || !resourceId) throw new BookingError("slot_taken", "invalid slot");
  return { startAt, resourceId };
};

export function registerBookingActions(registry: MapActionRegistry, scheduling: SchedulingService): void {
  registry.register("booking.services", async (_params, ctx): Promise<DynamicRow[]> => {
    const services = await scheduling.services(ctx.tenantId);
    return services.map((o) => ({
      id: o.id,
      title: localized(o.name, ctx.language),
      description: `${formatMoney(o.priceMinor, o.currency)}${o.durationMinutes ? ` · ${o.durationMinutes} ${t(COPY.minutes, ctx.language)}` : ""}`,
    }));
  });

  registry.register("booking.staff", async (params, ctx): Promise<DynamicRow[]> => {
    const staff = await scheduling.staffFor(ctx.tenantId, String(params.serviceId ?? ""));
    if (staff.length === 0) return [];
    return [{ id: ANY_RESOURCE, title: t(COPY.anyone, ctx.language) }, ...staff.map((r) => ({ id: r.id, title: localized(r.name, ctx.language) }))];
  });

  registry.register("booking.days", async (params, ctx): Promise<DynamicRow[]> => {
    const { tz } = await scheduling.settings(ctx.tenantId);
    const days = await scheduling.availableDays(ctx.tenantId, String(params.serviceId ?? ""), String(params.resourceId ?? ANY_RESOURCE), { count: 7 });
    return days.map((d) => ({ id: d, title: formatDay(d, tz, ctx.language) }));
  });

  registry.register("booking.slots", async (params, ctx): Promise<DynamicRow[]> => {
    const { tz } = await scheduling.settings(ctx.tenantId);
    const resourceId = String(params.resourceId ?? ANY_RESOURCE);
    const period = PERIODS.includes(params.period as Period) ? (params.period as Period) : undefined;
    const slots = await scheduling.slots(ctx.tenantId, String(params.serviceId ?? ""), resourceId, String(params.date ?? ""), { period });
    return slots.slice(0, 10).map((s) => ({
      id: slotId(s.startAt, s.resource.id),
      title: formatTime(s.startAt, tz, ctx.language),
      description: resourceId === ANY_RESOURCE ? localized(s.resource.name, ctx.language) : undefined,
    }));
  });

  registry.register("booking.create", async (params, ctx) => {
    if (!ctx.customer.id) throw new BookingError("unavailable", "customer id missing from action context");
    const { startAt, resourceId } = parseSlotId(String(params.slotId ?? ""));
    const { order, offering, resource, settings } = await scheduling.book({
      tenantId: ctx.tenantId,
      customerId: ctx.customer.id,
      conversationId: ctx.conversationId,
      offeringId: String(params.serviceId ?? ""),
      resourceId,
      startAt,
      language: ctx.language,
    });
    const when = formatWhen(startAt, settings.tz, ctx.language);
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      when,
      text: t(COPY.bookingPlaced, ctx.language, {
        service: localized(offering.name, ctx.language),
        staff: localized(resource.name, ctx.language),
        when,
        total: formatMoney(order.totalMinor, order.currency),
      }),
    };
  });

  registry.register("booking.upcoming", async (_params, ctx) => {
    if (!ctx.customer.id) return { count: 0, rows: [], text: t(COPY.noUpcoming, ctx.language) };
    const { tz } = await scheduling.settings(ctx.tenantId);
    const bookings = await scheduling.upcoming(ctx.tenantId, ctx.customer.id);
    const rows: DynamicRow[] = [];
    for (const b of bookings) {
      const resource = b.resourceId ? await scheduling.resource(ctx.tenantId, b.resourceId) : null;
      rows.push({
        id: b.id,
        // Row titles are clipped to 24 characters by the runner, so the date carries the title and the rest goes below it.
        title: formatWhen(new Date(b.scheduledAt!), tz, ctx.language),
        description: [b.items[0]?.title ?? "", resource ? localized(resource.name, ctx.language) : "", statusLabel(b.status, ctx.language)].filter(Boolean).join(" · "),
      });
    }
    return { count: rows.length, rows, text: rows.length ? "" : t(COPY.noUpcoming, ctx.language) };
  });

  registry.register("booking.cancel", async (params, ctx) => {
    if (!ctx.customer.id) return { cancelled: false, text: t(COPY.cannotCancel, ctx.language) };
    const { tz } = await scheduling.settings(ctx.tenantId);
    try {
      const order = await scheduling.cancel(ctx.tenantId, ctx.customer.id, String(params.orderId ?? ""));
      return { cancelled: true, text: t(COPY.bookingCancelled, ctx.language, { when: formatWhen(new Date(order.scheduledAt!), tz, ctx.language) }) };
    } catch (err) {
      if (err instanceof BookingError) return { cancelled: false, text: t(COPY.cannotCancel, ctx.language) };
      throw err;
    }
  });
}
