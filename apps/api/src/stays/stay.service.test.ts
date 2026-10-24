import { getBlueprint } from "@ordr/blueprints";
import { describe, expect, it } from "vitest";
import { demoResortCatalog } from "../actions/demo-resort";
import { InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore } from "../adapters/memory-catalog";
import { InMemoryBookingHoldRepository } from "../adapters/memory-commerce";
import { InMemoryPropertyRepository, InMemoryStayRepository } from "../adapters/memory-stays";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OrderService } from "../orders/order.service";
import { StayError, StayService } from "./stay.service";

/** Tuesday 20 Oct 2026, 10:00 in Dubai. */
const NOW = new Date("2026-10-20T06:00:00Z");

export function setupStays() {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "resort", SEED_TENANT_NAME: "Al Noor Resorts" });
  const seed = seedTenantFromConfig(config);
  const demo = demoResortCatalog(seed.tenant.id);
  const orders = new InMemoryOrderRepository();
  const holds = new InMemoryBookingHoldRepository(orders);
  orders.holds = holds;
  const catalog = new InMemoryCatalogRepository(demo.categories, demo.offerings);
  const properties = new InMemoryPropertyRepository(demo.properties);
  const bus = new InMemoryEventBus();
  const outbox = new InMemoryOutboxStore();
  const orderService = new OrderService(orders, new InMemoryTenantRepository([seed]), { get: getBlueprint }, bus, outbox);
  const stays = new StayService(catalog, properties, orders, holds, new InMemoryStayRepository(orders, holds), { get: getBlueprint }, orderService, config);
  stays.now = () => NOW;
  return { stays, orders, holds, catalog, properties, bus, outbox, seed, tenantId: seed.tenant.id };
}

describe("StayService", () => {
  it("searches across four resorts, prices per night, and keeps per-night inventory", async () => {
    const h = setupStays();
    expect((await h.stays.listProperties(h.tenantId)).map((p) => p.id)).toEqual(["prop_palm", "prop_hatta", "prop_dunes", "prop_fujairah"]);

    const options = await h.stays.search(h.tenantId, { checkIn: "2026-12-24", checkOut: "2026-12-27", guests: 2 });
    // Every room type sleeps two or more; totals are nightly x 3 and VAT is inclusive.
    expect(options).toHaveLength(10);
    const palm = options.find((o) => o.offering.id === "stay_palm_deluxe")!;
    expect(palm).toMatchObject({ available: 20, quote: { nights: 3, nightlyMinor: 95000, totalMinor: 285000, currency: "AED" } });
    expect(palm.property.id).toBe("prop_palm");
    // A party of five fits only the family rooms and villas.
    expect((await h.stays.search(h.tenantId, { checkIn: "2026-12-24", checkOut: "2026-12-25", guests: 5 })).map((o) => o.offering.id)).toEqual(["stay_palm_villa", "stay_hatta_family"]);
    // One property only.
    expect((await h.stays.search(h.tenantId, { checkIn: "2026-12-24", checkOut: "2026-12-25", guests: 2, propertyId: "prop_dunes" })).map((o) => o.offering.id)).toEqual(["stay_dunes_tent", "stay_dunes_royal"]);
  });

  it("rejects bad dates with reasons the agent can relay", async () => {
    const h = setupStays();
    await expect(h.stays.search(h.tenantId, { checkIn: "2026-10-19", checkOut: "2026-10-21", guests: 2 })).rejects.toMatchObject({ code: "invalid_dates" });
    await expect(h.stays.search(h.tenantId, { checkIn: "2026-10-22", checkOut: "2026-10-22", guests: 2 })).rejects.toMatchObject({ code: "invalid_dates" });
    await expect(h.stays.search(h.tenantId, { checkIn: "2026-10-22", checkOut: "2026-12-22", guests: 2 })).rejects.toMatchObject({ code: "invalid_dates" });
    await expect(h.stays.search(h.tenantId, { checkIn: "2028-01-01", checkOut: "2028-01-02", guests: 2 })).rejects.toMatchObject({ code: "invalid_dates" });
    await expect(h.stays.hold({ tenantId: h.tenantId, customerId: "c1", offeringId: "stay_palm_deluxe", checkIn: "2026-11-01", checkOut: "2026-11-02", guests: 4 })).rejects.toMatchObject({ code: "too_many_guests" });
  });

  it("holds then confirms a stay; the last unit is gone for others but not the holder; overlapping nights are what count", async () => {
    const h = setupStays();
    const dates = { checkIn: "2026-11-10", checkOut: "2026-11-13" };
    // Three beach villas. Two other customers hold two of them for overlapping nights.
    const a = await h.stays.hold({ tenantId: h.tenantId, customerId: "c-a", offeringId: "stay_palm_villa", checkIn: "2026-11-09", checkOut: "2026-11-11", guests: 4 });
    const b = await h.stays.hold({ tenantId: h.tenantId, customerId: "c-b", offeringId: "stay_palm_villa", checkIn: "2026-11-12", checkOut: "2026-11-14", guests: 4 });
    expect(a.hold.resourceId).toBe("stay_palm_villa");
    // Night 10 has one hold, night 12 has one hold: still 2 free on the busiest night.
    const search = await h.stays.search(h.tenantId, { ...dates, guests: 4, propertyId: "prop_palm" });
    expect(search.find((o) => o.offering.id === "stay_palm_villa")?.available).toBe(2);
    const c = await h.stays.hold({ tenantId: h.tenantId, customerId: "c-c", offeringId: "stay_palm_villa", ...dates, guests: 6 });
    const d = await h.stays.hold({ tenantId: h.tenantId, customerId: "c-d", offeringId: "stay_palm_villa", ...dates, guests: 2 });
    expect(d.quote).toMatchObject({ nights: 3, totalMinor: 1350000 });
    // Full now: a fifth customer cannot hold the same nights, but anyone can hold nights nobody touches.
    await expect(h.stays.hold({ tenantId: h.tenantId, customerId: "c-e", offeringId: "stay_palm_villa", ...dates, guests: 2 })).rejects.toMatchObject({ code: "no_availability" });
    expect((await h.stays.search(h.tenantId, { ...dates, guests: 2, propertyId: "prop_palm" })).find((o) => o.offering.id === "stay_palm_villa")?.available).toBe(0);
    // ...but the holder still sees their own unit as free.
    expect((await h.stays.search(h.tenantId, { ...dates, guests: 2, propertyId: "prop_palm", forCustomerId: "c-d" })).find((o) => o.offering.id === "stay_palm_villa")?.available).toBe(1);
    await h.stays.hold({ tenantId: h.tenantId, customerId: "c-e", offeringId: "stay_palm_villa", checkIn: "2026-11-20", checkOut: "2026-11-22", guests: 2 });

    // c-d confirms: an order of kind stay with check-in/check-out instants from the property's times (Dubai = UTC+4).
    const { order } = await h.stays.confirmHold({ tenantId: h.tenantId, customerId: "c-d", holdId: d.hold.id, guests: 2, guestName: "Omar K.", notes: "late arrival", language: "en" });
    expect(order).toMatchObject({ kind: "stay", status: "requested", propertyId: "prop_palm", guests: 2, totalMinor: 1350000, scheduledAt: "2026-11-10T11:00:00.000Z", checkOutAt: "2026-11-13T08:00:00.000Z", notes: "Guest: Omar K.\nlate arrival", fulfillmentType: "stay" });
    expect(order.items[0]).toMatchObject({ offeringId: "stay_palm_villa", quantity: 3, unitPriceMinor: 450000, title: "Beach Villa with Pool · Palm Lagoon Beach Resort" });
    expect(h.holds.holds.find((x) => x.id === d.hold.id)?.status).toBe("confirmed");
    expect(h.bus.published.map((e) => e.type)).toContain("order.placed");
    // The reminder is queued a day before check-in.
    expect(h.outbox.rows.some((r) => r.type === "booking.reminder" && r.nextAttemptAt === new Date("2026-11-09T11:00:00.000Z").getTime())).toBe(true);
    // Confirming again is refused; another customer cannot use the hold.
    await expect(h.stays.confirmHold({ tenantId: h.tenantId, customerId: "c-d", holdId: d.hold.id, guests: 2, language: "en" })).rejects.toBeInstanceOf(StayError);
    await expect(h.stays.confirmHold({ tenantId: h.tenantId, customerId: "c-x", holdId: c.hold.id, guests: 2, language: "en" })).rejects.toMatchObject({ code: "not_found" });

    // c-c releases theirs; the order and the two outside holds remain: one villa free again on the busiest night.
    await h.stays.releaseHold(h.tenantId, "c-c", c.hold.id);
    expect((await h.stays.search(h.tenantId, { ...dates, guests: 2, propertyId: "prop_palm" })).find((o) => o.offering.id === "stay_palm_villa")?.available).toBe(1);
    // Upcoming and cancel.
    expect((await h.stays.upcoming(h.tenantId, "c-d")).map((o) => o.id)).toEqual([order.id]);
    const cancelled = await h.stays.cancel(h.tenantId, "c-d", order.id);
    expect(cancelled.status).toBe("cancelled");
    expect((await h.stays.search(h.tenantId, { ...dates, guests: 2, propertyId: "prop_palm" })).find((o) => o.offering.id === "stay_palm_villa")?.available).toBe(2);
    void b;
  });

  it("a hold expires and a same-day turnover does not block", async () => {
    const h = setupStays();
    const first = await h.stays.hold({ tenantId: h.tenantId, customerId: "c1", offeringId: "stay_dunes_royal", checkIn: "2026-11-01", checkOut: "2026-11-03", guests: 2 });
    await h.stays.hold({ tenantId: h.tenantId, customerId: "c2", offeringId: "stay_dunes_royal", checkIn: "2026-11-01", checkOut: "2026-11-03", guests: 2 });
    await h.stays.hold({ tenantId: h.tenantId, customerId: "c3", offeringId: "stay_dunes_royal", checkIn: "2026-11-01", checkOut: "2026-11-03", guests: 2 });
    await expect(h.stays.hold({ tenantId: h.tenantId, customerId: "c4", offeringId: "stay_dunes_royal", checkIn: "2026-11-02", checkOut: "2026-11-04", guests: 2 })).rejects.toMatchObject({ code: "no_availability" });
    // Checking in the day the others leave is fine.
    await h.stays.hold({ tenantId: h.tenantId, customerId: "c4", offeringId: "stay_dunes_royal", checkIn: "2026-11-03", checkOut: "2026-11-05", guests: 2 });
    // Time passes: the first hold lapses and the nights open up again.
    h.stays.now = () => new Date(NOW.getTime() + 11 * 60_000);
    expect(await h.holds.expire(h.stays.now())).toBeGreaterThan(0);
    expect((await h.stays.search(h.tenantId, { checkIn: "2026-11-01", checkOut: "2026-11-03", guests: 2, propertyId: "prop_dunes" })).find((o) => o.offering.id === "stay_dunes_royal")?.available).toBe(3);
    await expect(h.stays.confirmHold({ tenantId: h.tenantId, customerId: "c1", holdId: first.hold.id, guests: 2, language: "en" })).rejects.toMatchObject({ code: "no_availability" });
  });
});
