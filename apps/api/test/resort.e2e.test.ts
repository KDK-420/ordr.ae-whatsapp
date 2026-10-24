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
import { StayService } from "../src/stays/stay.service";

const EMAIL = "owner@resorts.test";
const PASSWORD = "very-secret-password";

describe("resort tenant", () => {
  let app: INestApplication;
  let conversations: InMemoryConversationRepository;
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", WHATSAPP_SENDER: "log", SEED_PHONE_NUMBER_ID: "200000000000000", SEED_BLUEPRINT_ID: "resort", SEED_TENANT_NAME: "Al Noor Resorts", SEED_ADMIN_EMAIL: EMAIL, SEED_ADMIN_PASSWORD: PASSWORD });

  beforeEach(async () => {
    conversations = new InMemoryConversationRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register({ config, overrides: { sender: new FakeSender(), conversations, sessions: new InMemorySessionStore(), tenants: new InMemoryTenantRepository([seedTenantFromConfig(config)]), orders: new InMemoryOrderRepository(), eventBus: new InMemoryEventBus(), dedupe: new InMemoryDedupeStore() } })],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it("one owner manages four resorts and their room types from one account, and stays reach the orders board", async () => {
    const server = app.getHttpServer();
    const token = (await request(server).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD }).expect(200)).body.token as string;
    const auth = { authorization: `Bearer ${token}` };

    const me = await request(server).get("/merchant/me").set(auth).expect(200);
    expect(me.body.tenant.modules).toContain("properties");

    const list = await request(server).get("/merchant/properties").set(auth).expect(200);
    expect(list.body.properties.map((p: { name: { en: string } }) => p.name.en)).toEqual(["Palm Lagoon Beach Resort", "Hatta Mountain Lodge", "Liwa Dunes Desert Camp", "Fujairah Bay Dive Resort"]);

    const created = await request(server).post("/merchant/properties").set(auth).send({ name: { en: "Ras Al Khaimah Cliff Hotel" }, address: "Jebel Jais Road", checkInTime: "14:00", checkOutTime: "11:00", amenities: ["Zipline shuttle"], imageUrls: ["https://picsum.photos/seed/rak/1200/800"] }).expect(201);
    expect(created.body).toMatchObject({ checkInTime: "14:00", amenities: ["Zipline shuttle"], isActive: true });
    await request(server).post("/merchant/properties").set(auth).send({ name: {}, checkInTime: "25:00" }).expect(400);

    // A room type must belong to one of this tenant's resorts.
    const room = await request(server).post("/merchant/catalog/offerings").set(auth).send({ type: "stay", name: { en: "Cliff Suite" }, priceMinor: 120000, propertyId: created.body.id, maxGuests: 3, units: 5, imageUrl: "https://picsum.photos/seed/cliff/1200/800" }).expect(201);
    expect(room.body).toMatchObject({ type: "stay", propertyId: created.body.id, maxGuests: 3, units: 5 });
    await request(server).post("/merchant/catalog/offerings").set(auth).send({ type: "stay", name: { en: "Orphan" }, priceMinor: 1000 }).expect(400);
    await request(server).post("/merchant/catalog/offerings").set(auth).send({ type: "stay", name: { en: "Foreign" }, priceMinor: 1000, propertyId: "prop_of_someone_else" }).expect(400);

    // The new resort is bookable right away through the stay engine, and the board shows the stay with its resort.
    const stays = app.get(StayService);
    const options = await stays.search("tenant_seed", { checkIn: "2027-01-10", checkOut: "2027-01-12", guests: 3 });
    expect(options.map((o) => o.offering.id)).toContain(room.body.id);
    const customer = await conversations.upsertCustomer("tenant_seed", "971500000009", "Lina");
    const { hold } = await stays.hold({ tenantId: "tenant_seed", customerId: customer.id, offeringId: room.body.id, checkIn: "2027-01-10", checkOut: "2027-01-12", guests: 3 });
    await stays.confirmHold({ tenantId: "tenant_seed", customerId: customer.id, holdId: hold.id, guests: 3, guestName: "Lina H.", language: "en" });
    const board = await request(server).get("/merchant/orders?scope=board").set(auth).expect(200);
    expect(board.body.states.states).toContain("checked_out");
    expect(board.body.orders[0]).toMatchObject({ kind: "stay", guests: 3, propertyId: created.body.id, propertyName: "Ras Al Khaimah Cliff Hotel", allowedEvents: ["confirm", "reject", "cancel"], items: [{ title: "Cliff Suite · Ras Al Khaimah Cliff Hotel", quantity: 2 }] });

    // Staff may read but not change resorts.
    const staff = await request(server).post("/merchant/users").set(auth).send({ email: "front@resorts.test", name: "Front desk", role: "staff" }).expect(201);
    const staffToken = (await request(server).post("/merchant/auth/login").send({ email: "front@resorts.test", password: staff.body.temporaryPassword }).expect(200)).body.token as string;
    await request(server).get("/merchant/properties").set({ authorization: `Bearer ${staffToken}` }).expect(200);
    await request(server).patch(`/merchant/properties/${created.body.id}`).set({ authorization: `Bearer ${staffToken}` }).send({ isActive: false }).expect(403);
  });
});
