import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender } from "@ordr/whatsapp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository } from "../src/adapters/memory";
import { InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { loadConfig } from "../src/config";
import { SchedulingService } from "../src/scheduling/scheduling.service";

const EMAIL = "owner@demo.test";
const PASSWORD = "very-secret-password";
/** Tuesday 20 Oct 2026, 10:00 in Dubai. */
const NOW = new Date("2026-10-20T06:00:00Z");

describe("salon merchant API", () => {
  let app: INestApplication;
  let tenantId: string;

  beforeEach(async () => {
    const config = loadConfig({
      META_APP_SECRET: "test-app-secret",
      META_VERIFY_TOKEN: "test-verify-token",
      STORAGE: "memory",
      WHATSAPP_SENDER: "log",
      SEED_PHONE_NUMBER_ID: "200000000000000",
      SEED_BLUEPRINT_ID: "salon",
      SEED_TENANT_NAME: "Demo Salon",
      SEED_ADMIN_EMAIL: EMAIL,
      SEED_ADMIN_PASSWORD: PASSWORD,
    });
    const seed = seedTenantFromConfig(config);
    tenantId = seed.tenant.id;
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register({
          config,
          overrides: {
            sender: new FakeSender(),
            conversations: new InMemoryConversationRepository(),
            sessions: new InMemorySessionStore(),
            tenants: new InMemoryTenantRepository([seed]),
            orders: new InMemoryOrderRepository(),
            eventBus: new InMemoryEventBus(),
            dedupe: new InMemoryDedupeStore(),
          },
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.init();
    app.get(SchedulingService).now = () => NOW;
  });
  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const login = async () => {
    const res = await request(server()).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD });
    return `Bearer ${res.body.token as string}`;
  };

  it("exposes the vertical's modules, manages resources and lists bookings for the calendar", async () => {
    const auth = await login();
    const me = await request(server()).get("/merchant/me").set("authorization", auth);
    expect(me.body.tenant.modules).toContain("calendar");

    const listed = await request(server()).get("/merchant/resources").set("authorization", auth);
    expect(listed.body.resources.map((r: { id: string }) => r.id)).toEqual(["res_sara", "res_mona"]);

    const created = await request(server())
      .post("/merchant/resources")
      .set("authorization", auth)
      .send({ name: { en: "Lina", ar: "لينا" }, hours: { mon: [{ start: "10:00", end: "18:00" }] }, skills: ["svc_manicure"], sortOrder: 3 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ type: "staff", name: { en: "Lina" }, skills: ["svc_manicure"], isActive: true });
    const bad = await request(server()).post("/merchant/resources").set("authorization", auth).send({ name: { en: "X" }, hours: { mon: [{ start: "18:00", end: "10:00" }] } });
    expect(bad.status).toBe(400);

    const patched = await request(server()).patch(`/merchant/resources/${created.body.id}`).set("authorization", auth).send({ isActive: false });
    expect(patched.body.isActive).toBe(false);
    expect((await request(server()).patch("/merchant/resources/nope").set("authorization", auth).send({ isActive: false })).status).toBe(404);

    // A customer books through the scheduling service; the calendar sees it on Sara.
    const scheduling = app.get(SchedulingService);
    const at = new Date("2026-10-20T09:00:00Z");
    const { order } = await scheduling.book({ tenantId, customerId: "c1", offeringId: "svc_haircut", resourceId: "any", startAt: at, language: "en" });

    const day = await request(server()).get("/merchant/bookings").set("authorization", auth).query({ from: "2026-10-19T20:00:00Z", to: "2026-10-20T20:00:00Z" });
    expect(day.status).toBe(200);
    expect(day.body.timezone).toBe("Asia/Dubai");
    expect(day.body.resources.map((r: { id: string }) => r.id)).toEqual(["res_sara", "res_mona", created.body.id]);
    expect(day.body.states.initial).toBe("requested");
    expect(day.body.bookings).toHaveLength(1);
    expect(day.body.bookings[0]).toMatchObject({ id: order.id, kind: "booking", resourceId: "res_sara", scheduledAt: at.toISOString(), durationMinutes: 45, allowedEvents: ["confirm", "reject", "cancel"] });

    const empty = await request(server()).get("/merchant/bookings").set("authorization", auth).query({ from: "2026-10-21T20:00:00Z", to: "2026-10-22T20:00:00Z" });
    expect(empty.body.bookings).toEqual([]);
    expect((await request(server()).get("/merchant/bookings").set("authorization", auth).query({ from: "nope" })).status).toBe(400);

    const confirmed = await request(server()).post(`/merchant/orders/${order.id}/transition`).set("authorization", auth).send({ event: "confirm" });
    expect(confirmed.body).toMatchObject({ status: "confirmed", allowedEvents: ["check_in", "cancel", "no_show"] });
  });
});
