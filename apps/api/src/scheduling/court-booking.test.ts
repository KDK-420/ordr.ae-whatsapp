import { getBlueprint } from "@ordr/blueprints";
import { MapActionRegistry } from "@ordr/flow-schema";
import { describe, expect, it } from "vitest";
import { registerBookingActions } from "../actions/booking.actions";
import { demoSportsCatalog } from "../actions/demo-sports";
import { InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryBookingHoldRepository } from "../adapters/memory-commerce";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore, InMemoryResourceRepository } from "../adapters/memory-catalog";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OrderService } from "../orders/order.service";
import { ANY_RESOURCE, atResource, SchedulingService } from "./scheduling.service";

const DAY = 24 * 60 * 60_000;

/** 18:00 Dubai (14:00 UTC) three days out: inside opening hours and the booking window. */
function evening(): Date {
  const d = new Date(Date.now() + 3 * DAY);
  d.setUTCHours(14, 0, 0, 0);
  return d;
}

function setup(profile?: Record<string, string>) {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "sports", SEED_TENANT_NAME: "Demo Courts", SEED_PHONE_NUMBER_ID: "200000000000000" });
  const seed = seedTenantFromConfig(config);
  if (profile) seed.tenant.settings.profile = profile;
  const tenantId = seed.tenant.id;
  const demo = demoSportsCatalog(tenantId);
  const tenants = new InMemoryTenantRepository([seed]);
  const orders = new InMemoryOrderRepository();
  const outbox = new InMemoryOutboxStore();
  const orderService = new OrderService(orders, tenants, { get: getBlueprint }, new InMemoryEventBus(), outbox);
  const scheduling = new SchedulingService(new InMemoryCatalogRepository(demo.categories, demo.offerings), new InMemoryResourceRepository(demo.resources), orders, { get: getBlueprint }, orderService, new InMemoryBookingHoldRepository(orders), config);
  const book = (offeringId: string, resourceId: string, startAt: Date, customerId = "cust_1") => scheduling.book({ tenantId, customerId, offeringId, resourceId, startAt, language: "en" });
  return { tenantId, scheduling, outbox, book };
}

describe("court booking", () => {
  it("confirms a court on the spot and queues the reminders", async () => {
    const h = setup();
    const { order, resource } = await h.book("svc_padel_60", ANY_RESOURCE, evening());
    expect(order.status).toBe("confirmed");
    expect(order.totalMinor).toBe(20000);
    expect(resource.id).toBe("res_padel_1");
    expect(h.outbox.rows.filter((r) => r.type === "booking.reminder")).toHaveLength(2);
  });

  it("keeps each sport on its own courts", async () => {
    const h = setup();
    expect((await h.scheduling.staffFor(h.tenantId, "svc_padel_60")).map((r) => r.id)).toEqual(["res_padel_1", "res_padel_2"]);
    expect((await h.scheduling.staffFor(h.tenantId, "svc_tennis_60")).map((r) => r.id)).toEqual(["res_tennis_1"]);
    await expect(h.book("svc_tennis_60", "res_padel_1", evening())).rejects.toThrow();
  });

  it("fills the courts one by one, then refuses, and never double-books", async () => {
    const h = setup();
    const at = evening();
    expect((await h.book("svc_padel_60", ANY_RESOURCE, at, "cust_1")).resource.id).toBe("res_padel_1");
    expect((await h.book("svc_padel_60", ANY_RESOURCE, at, "cust_2")).resource.id).toBe("res_padel_2");
    await expect(h.book("svc_padel_60", ANY_RESOURCE, at, "cust_3")).rejects.toThrow();
    // Another sport is unaffected.
    expect((await h.book("svc_tennis_60", ANY_RESOURCE, at, "cust_3")).resource.id).toBe("res_tennis_1");
  });

  it("blocks a court for the whole duration, with no gap needed between games", async () => {
    const h = setup();
    const at = evening();
    await h.book("svc_padel_90", "res_padel_1", at);
    await expect(h.book("svc_padel_60", "res_padel_1", new Date(at.getTime() + 60 * 60_000))).rejects.toThrow();
    // 90 minutes later the court is free again straight away.
    const next = await h.book("svc_padel_60", "res_padel_1", new Date(at.getTime() + 90 * 60_000), "cust_2");
    expect(next.order.status).toBe("confirmed");
  });

  it("speaks about courts: the any option, and a confirmation with the address", async () => {
    const h = setup({ address: "Indigo Tower, JLT", mapsUrl: "https://maps.app.goo.gl/demo" });
    const registry = new MapActionRegistry();
    registerBookingActions(registry, h.scheduling);
    const ctx = { tenantId: h.tenantId, language: "en", context: {}, customer: { id: "cust_1", waId: "971500000001", name: "Noor" } };
    const run = (name: string, params: Record<string, unknown>) => registry.get(name)!(params, ctx as never) as Promise<unknown>;

    const rows = (await run("booking.staff", { serviceId: "svc_padel_60" })) as Array<{ id: string; title: string }>;
    expect(rows[0]).toEqual({ id: ANY_RESOURCE, title: "Any free court" });

    const at = evening();
    const booked = (await run("booking.create", { serviceId: "svc_padel_60", slotId: `${at.toISOString()}|res_padel_2` })) as { status: string; text: string };
    expect(booked.status).toBe("confirmed");
    expect(booked.text).toContain("Padel 60 min on *Padel Court 2*");
    expect(booked.text).toContain("Booking number 1");
    expect(booked.text).toContain("📍 Indigo Tower, JLT");
    expect(booked.text).toContain("https://maps.app.goo.gl/demo");
    expect(booked.text).not.toContain("confirm shortly");
  });

  it("keeps people wording for people", () => {
    expect(atResource("staff", "Sara")).toBe("with Sara");
    expect(atResource("court", "Court 2")).toBe("on Court 2");
  });
});
