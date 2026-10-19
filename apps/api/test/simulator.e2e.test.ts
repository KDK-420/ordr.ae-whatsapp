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
import { DemoAwareSender } from "../src/simulator/simulator.service";

const EMAIL = "owner@demo.test";
const PASSWORD = "very-secret-password";

describe("demo simulator", () => {
  let app: INestApplication;
  let transport: FakeSender;

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
    transport = new FakeSender();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register({
          config,
          overrides: {
            sender: new DemoAwareSender(transport),
            conversations: new InMemoryConversationRepository(),
            sessions: new InMemorySessionStore(),
            tenants: new InMemoryTenantRepository([seedTenantFromConfig(config)]),
            orders: new InMemoryOrderRepository(),
            eventBus: new InMemoryEventBus(),
            dedupe: new InMemoryDedupeStore(),
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
  const login = async () => {
    const res = await request(server()).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD });
    return `Bearer ${res.body.token as string}`;
  };

  it("creates a demo customer, chats with the real bot and never sends to Meta", async () => {
    const auth = await login();
    expect((await request(server()).get("/merchant/simulator/customers")).status).toBe(401);

    const created = await request(server()).post("/merchant/simulator/customers").set("authorization", auth).send({ name: "Boss" });
    expect(created.status).toBe(201);
    const waId = created.body.waId as string;
    expect(waId).toMatch(/^000\d{12}$/);

    const listed = await request(server()).get("/merchant/simulator/customers").set("authorization", auth);
    expect(listed.body.customers).toEqual([expect.objectContaining({ waId, name: "Boss" })]);

    const hi = await request(server()).post(`/merchant/simulator/customers/${waId}/messages`).set("authorization", auth).send({ kind: "text", text: "hi" });
    expect(hi.status).toBe(200);
    const msgs = hi.body.messages as Array<{ direction: string; kind: string; payload: { interactive?: { type: string } } }>;
    expect(msgs.map((m) => m.direction)).toEqual(["in", "out"]);
    expect(msgs[1]!.payload.interactive?.type).toBe("button");
    expect(transport.sent).toHaveLength(0);

    const booked = await request(server()).post(`/merchant/simulator/customers/${waId}/messages`).set("authorization", auth).send({ kind: "button", id: "book", title: "Book appointment" });
    const last = booked.body.messages.at(-1) as { preview: string; payload: { interactive: { type: string } } };
    expect(last.preview).toBe("Which service would you like?");
    expect(last.payload.interactive.type).toBe("list");

    const reset = await request(server()).post(`/merchant/simulator/customers/${waId}/reset`).set("authorization", auth);
    expect(reset.status).toBe(200);
    const again = await request(server()).post(`/merchant/simulator/customers/${waId}/messages`).set("authorization", auth).send({ kind: "text", text: "hello" });
    expect((again.body.messages.at(-1) as { preview: string }).preview).toBe("Welcome to Demo Salon! What would you like to do?");

    expect((await request(server()).get("/merchant/simulator/customers/971500000001").set("authorization", auth)).status).toBe(404);
    expect((await request(server()).post(`/merchant/simulator/customers/${waId}/messages`).set("authorization", auth).send({ kind: "sticker" })).status).toBe(400);
  });
});
