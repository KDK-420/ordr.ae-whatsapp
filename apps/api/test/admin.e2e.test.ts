import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender, fixtures, parseWebhook } from "@ordr/whatsapp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemoryNumberPoolRepository, InMemorySessionStore, InMemoryTenantRepository, InMemoryUserRepository } from "../src/adapters/memory";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryResourceRepository } from "../src/adapters/memory-catalog";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { hashPassword } from "../src/auth/password";
import { loadConfig } from "../src/config";
import { ConversationService } from "../src/conversation/conversation.service";

const ADMIN = { email: "ops@ordr.test", password: "platform-password-1" };
const STAFF = { email: "staff@demo.test", password: "staff-password-123" };

describe("platform admin: tenants and the number pool", () => {
  let app: INestApplication;
  let sender: FakeSender;

  beforeEach(async () => {
    const config = loadConfig({ META_APP_SECRET: "test-app-secret", META_VERIFY_TOKEN: "test-verify-token", STORAGE: "memory", WHATSAPP_SENDER: "log", SEED_PHONE_NUMBER_ID: "200000000000000" });
    const seed = seedTenantFromConfig(config);
    sender = new FakeSender();
    const users = new InMemoryUserRepository([
      { tenantId: seed.tenant.id, email: ADMIN.email, name: "Ops", role: "owner", isPlatformAdmin: true, passwordHash: hashPassword(ADMIN.password) },
      { tenantId: seed.tenant.id, email: STAFF.email, name: "Staff", role: "owner", passwordHash: hashPassword(STAFF.password) },
    ]);
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register({
          config,
          overrides: {
            sender,
            users,
            tenants: new InMemoryTenantRepository([seed]),
            catalog: new InMemoryCatalogRepository(),
            resources: new InMemoryResourceRepository(),
            orders: new InMemoryOrderRepository(),
            conversations: new InMemoryConversationRepository(),
            sessions: new InMemorySessionStore(),
            dedupe: new InMemoryDedupeStore(),
            eventBus: new InMemoryEventBus(),
            numbers: new InMemoryNumberPoolRepository(),
          },
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const login = async (email: string, password: string) => {
    const res = await request(server()).post("/merchant/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    return { auth: `Bearer ${res.body.token as string}`, user: res.body.user as { platformAdmin: boolean; tenantId: string } };
  };

  it("lets a platform admin add numbers, create a salon with an owner and a number, and route its messages", async () => {
    const staff = await login(STAFF.email, STAFF.password);
    expect(staff.user.platformAdmin).toBe(false);
    expect((await request(server()).get("/merchant/admin/overview").set("authorization", staff.auth)).status).toBe(403);

    const { auth, user } = await login(ADMIN.email, ADMIN.password);
    expect(user.platformAdmin).toBe(true);
    const before = await request(server()).get("/merchant/admin/overview").set("authorization", auth);
    expect(before.status).toBe(200);
    expect(before.body.tenants.map((t: { tenant: { slug: string } }) => t.tenant.slug)).toEqual(["seed"]);
    expect(before.body.verticals.map((v: { id: string }) => v.id).sort()).toEqual(["resort", "restaurant", "retail", "salon"]);

    const added = await request(server())
      .post("/merchant/admin/numbers")
      .set("authorization", auth)
      .send({ phoneNumberId: "300000000000001", wabaId: "400000000000001", displayPhone: "+971 50 111 1111", accessToken: "EAAB-a-long-enough-system-user-token", label: "SIM 1" });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ phoneNumberId: "300000000000001", tenantId: null, label: "SIM 1" });
    expect(added.body.accessToken).toBeUndefined();
    expect((await request(server()).post("/merchant/admin/numbers").set("authorization", auth).send({ ...added.body, accessToken: "EAAB-a-long-enough-system-user-token" })).status).toBe(409);

    const created = await request(server())
      .post("/merchant/admin/tenants")
      .set("authorization", auth)
      .send({ name: "Glow Salon", blueprintId: "salon", ownerEmail: "Owner@Glow.test", ownerName: "Lina", numberId: added.body.id });
    expect(created.status).toBe(201);
    expect(created.body.tenant).toMatchObject({ name: "Glow Salon", slug: "glow-salon", blueprintId: "salon" });
    expect(created.body.owner).toMatchObject({ email: "owner@glow.test" });
    expect(created.body.channel).toMatchObject({ phoneNumberId: "300000000000001", displayPhone: "+971 50 111 1111" });
    const tempPassword = created.body.owner.temporaryPassword as string;
    expect(tempPassword).toHaveLength(14);
    expect((await request(server()).post("/merchant/admin/tenants").set("authorization", auth).send({ name: "Glow Salon", blueprintId: "salon", ownerEmail: "owner@glow.test", ownerName: "Lina" })).status).toBe(409);
    expect((await request(server()).post("/merchant/admin/tenants").set("authorization", auth).send({ name: "X", blueprintId: "salon", ownerEmail: "x@x.test", ownerName: "X" })).status).toBe(400);

    const after = await request(server()).get("/merchant/admin/overview").set("authorization", auth);
    expect(after.body.tenants[0]).toMatchObject({ tenant: { slug: "glow-salon" }, channel: { displayPhone: "+971 50 111 1111" }, owners: [{ email: "owner@glow.test" }] });
    expect(after.body.numbers[0].tenantId).toBe(created.body.tenant.id);

    // The new owner signs in and sees the salon demo catalog and staff, with fresh ids.
    const owner = await login("owner@glow.test", tempPassword);
    expect(owner.user.tenantId).toBe(created.body.tenant.id);
    const catalog = await request(server()).get("/merchant/catalog").set("authorization", owner.auth);
    expect(catalog.body.offerings.map((o: { name: { en: string } }) => o.name.en)).toEqual(["Haircut", "Blow dry", "Colour", "Manicure", "Pedicure"]);
    expect(catalog.body.offerings[0].id).not.toBe("svc_haircut");
    const team = await request(server()).get("/merchant/resources").set("authorization", owner.auth);
    expect(team.body.resources.map((r: { name: { en: string }; skills: string[] }) => [r.name.en, r.skills.length])).toEqual([["Sara", 0], ["Mona", 3]]);
    expect(team.body.resources[1].skills).toEqual(catalog.body.offerings.slice(0, 3).map((o: { id: string }) => o.id));

    // Messages to the new number reach the new tenant's bot.
    const conversations = app.get(ConversationService);
    for (const ev of parseWebhook(fixtures.textMessageWebhook("hi", { phoneNumberId: "300000000000001", from: "971500009999", profileName: "Noor" }))) await conversations.handleEvent(ev);
    const welcome = sender.to("971500009999").at(-1);
    expect(welcome && welcome.type === "interactive" && "body" in welcome.interactive ? welcome.interactive.body.text : welcome).toBe("Welcome to Glow Salon! What would you like to do?");

    // Releasing the number stops routing; assigning it to another tenant moves it.
    expect((await request(server()).post(`/merchant/admin/numbers/${added.body.id}/release`).set("authorization", auth)).body.tenantId).toBeNull();
    for (const ev of parseWebhook(fixtures.textMessageWebhook("hi again", { phoneNumberId: "300000000000001", from: "971500009999", profileName: "Noor" }))) await conversations.handleEvent(ev);
    expect(sender.to("971500009999")).toHaveLength(1);
    const moved = await request(server()).post(`/merchant/admin/numbers/${added.body.id}/assign`).set("authorization", auth).send({ tenantId: "tenant_seed" });
    expect(moved.body.tenantId).toBe("tenant_seed");
    expect((await request(server()).post("/merchant/admin/numbers/nope/assign").set("authorization", auth).send({ tenantId: "tenant_seed" })).status).toBe(404);

    const reset = await request(server()).post(`/merchant/admin/tenants/${created.body.tenant.id}/owners/${created.body.owner.id}/reset-password`).set("authorization", auth);
    expect(reset.body).toMatchObject({ email: "owner@glow.test" });
    await login("owner@glow.test", reset.body.temporaryPassword);
  });
});
