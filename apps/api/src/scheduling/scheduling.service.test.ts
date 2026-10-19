import { getBlueprint } from "@ordr/blueprints";
import { localTime } from "@ordr/domain";
import { describe, expect, it } from "vitest";
import { demoSalonCatalog } from "../actions/demo-salon";
import { InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryResourceRepository } from "../adapters/memory-catalog";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OrderService } from "../orders/order.service";
import { BookingError, SchedulingService } from "./scheduling.service";

const TZ = "Asia/Dubai";
/** Tuesday 20 Oct 2026, 10:00 in Dubai. Sara works 10-20, Mona 12-21 that day. */
const NOW = new Date("2026-10-20T06:00:00Z");

function setup() {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon" });
  const seed = seedTenantFromConfig(config);
  const demo = demoSalonCatalog(seed.tenant.id);
  const orders = new InMemoryOrderRepository();
  const bus = new InMemoryEventBus();
  const orderService = new OrderService(orders, new InMemoryTenantRepository([seed]), { get: getBlueprint }, bus);
  const scheduling = new SchedulingService(new InMemoryCatalogRepository(demo.categories, demo.offerings), new InMemoryResourceRepository(demo.resources), orders, { get: getBlueprint }, orderService);
  scheduling.now = () => NOW;
  return { scheduling, orders, bus, tenantId: seed.tenant.id };
}

const times = (slots: Array<{ startAt: Date; resource: { id: string } }>) => slots.map((s) => `${localTime(s.startAt, TZ)}@${s.resource.id}`);

describe("SchedulingService", () => {
  it("lists services and the staff able to perform them", async () => {
    const { scheduling, tenantId } = setup();
    expect((await scheduling.services(tenantId)).map((s) => s.id)).toEqual(["svc_haircut", "svc_blowdry", "svc_color", "svc_manicure", "svc_pedicure"]);
    expect((await scheduling.staffFor(tenantId, "svc_haircut")).map((r) => r.id)).toEqual(["res_sara", "res_mona"]);
    expect((await scheduling.staffFor(tenantId, "svc_manicure")).map((r) => r.id)).toEqual(["res_sara"]);
  });

  it("finds the next days with availability for anyone or a specific person", async () => {
    const { scheduling, tenantId } = setup();
    expect(await scheduling.availableDays(tenantId, "svc_haircut", "any")).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
    // Sara does not work Sundays, Mona does not work Mondays.
    expect(await scheduling.availableDays(tenantId, "svc_manicure", "res_sara", { count: 7 })).not.toContain("2026-10-25");
    expect(await scheduling.availableDays(tenantId, "svc_haircut", "res_mona", { count: 7 })).not.toContain("2026-10-26");
  });

  it("offers slots after the lead time, by period, preferring the first person in order", async () => {
    const { scheduling, tenantId } = setup();
    const morning = await scheduling.slots(tenantId, "svc_haircut", "any", "2026-10-20", { period: "morning" });
    expect(times(morning)).toEqual(["11:00@res_sara", "11:30@res_sara"]);
    const afternoon = await scheduling.slots(tenantId, "svc_haircut", "any", "2026-10-20", { period: "afternoon" });
    expect(times(afternoon).slice(0, 3)).toEqual(["12:00@res_sara", "12:30@res_sara", "13:00@res_sara"]);
    const monaOnly = await scheduling.slots(tenantId, "svc_haircut", "res_mona", "2026-10-20", { period: "afternoon" });
    expect(times(monaOnly)[0]).toBe("12:00@res_mona");
    const evening = await scheduling.slots(tenantId, "svc_color", "res_mona", "2026-10-20", { period: "evening" });
    // 90 minutes must end by 21:00.
    expect(times(evening).at(-1)).toBe("19:30@res_mona");
  });

  it("books, falls over to the next free person, refuses a taken slot, lists and cancels", async () => {
    const { scheduling, orders, bus, tenantId } = setup();
    const at = new Date("2026-10-20T09:00:00Z"); // 13:00 Dubai
    const first = await scheduling.book({ tenantId, customerId: "c1", offeringId: "svc_haircut", resourceId: "any", startAt: at, language: "en" });
    expect(first.resource.id).toBe("res_sara");
    expect(first.order).toMatchObject({ kind: "booking", status: "requested", resourceId: "res_sara", durationMinutes: 45, totalMinor: 8000, scheduledAt: at.toISOString() });
    expect(first.order.items[0]).toMatchObject({ offeringId: "svc_haircut", title: "Haircut", quantity: 1 });

    const second = await scheduling.book({ tenantId, customerId: "c2", offeringId: "svc_haircut", resourceId: "any", startAt: at, language: "ar" });
    expect(second.resource.id).toBe("res_mona");
    expect(second.order.items[0]!.title).toBe("قص شعر");

    await expect(scheduling.book({ tenantId, customerId: "c3", offeringId: "svc_haircut", resourceId: "any", startAt: at, language: "en" })).rejects.toMatchObject({ code: "slot_taken" } satisfies Partial<BookingError>);
    // The buffer keeps 13:30 off Sara's list too (13:00 + 45 min + 10 min buffer).
    const after = await scheduling.slots(tenantId, "svc_haircut", "res_sara", "2026-10-20", { period: "afternoon" });
    expect(times(after)).not.toContain("13:30@res_sara");
    expect(times(after)).toContain("14:00@res_sara");

    // A direct repository conflict (bypassing the availability check) is refused as well.
    await expect(
      orders.createBooking({ ...first.order, initialStatus: "requested", scheduledAt: new Date(at.getTime() + 10 * 60_000), resourceId: "res_sara", durationMinutes: 30, items: [] } as never, ["requested", "confirmed"]),
    ).rejects.toThrow(/taken/);

    expect((await scheduling.upcoming(tenantId, "c1")).map((o) => o.id)).toEqual([first.order.id]);
    const cancelled = await scheduling.cancel(tenantId, "c1", first.order.id);
    expect(cancelled.status).toBe("cancelled");
    await expect(scheduling.cancel(tenantId, "c1", first.order.id)).rejects.toMatchObject({ code: "not_allowed" });
    await expect(scheduling.cancel(tenantId, "c2", first.order.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await scheduling.upcoming(tenantId, "c1")).toEqual([]);
    expect(bus.published.map((e) => e.type)).toEqual(["order.placed", "order.placed", "order.status_changed"]);
    expect(bus.published[0]!.payload).toMatchObject({ scheduledAt: at.toISOString(), resourceId: "res_sara" });
  });
});
