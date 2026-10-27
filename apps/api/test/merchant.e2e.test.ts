import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { addItem, emptyCart } from "@ordr/domain";
import { FakeSender } from "@ordr/whatsapp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemoryHandoffRequestRepository, InMemorySessionStore, InMemoryTenantRepository } from "../src/adapters/memory";
import { InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { loadConfig } from "../src/config";
import { OrderService } from "../src/orders/order.service";

const EMAIL = "owner@demo.test";
const PASSWORD = "very-secret-password";

interface Harness {
  app: INestApplication;
  sender: FakeSender;
  conversations: InMemoryConversationRepository;
  requests: InMemoryHandoffRequestRepository;
  orders: OrderService;
  tenantId: string;
}

async function createHarness(): Promise<Harness> {
  const config = loadConfig({
    META_APP_SECRET: "test-app-secret",
    META_VERIFY_TOKEN: "test-verify-token",
    STORAGE: "memory",
    WHATSAPP_SENDER: "log",
    SEED_PHONE_NUMBER_ID: "200000000000000",
    SEED_ADMIN_EMAIL: EMAIL,
    SEED_ADMIN_PASSWORD: PASSWORD,
  });
  const seed = seedTenantFromConfig(config);
  const sender = new FakeSender();
  const conversations = new InMemoryConversationRepository();
  const requests = new InMemoryHandoffRequestRepository();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.register({
        config,
        overrides: {
          sender,
          conversations,
          handoffRequests: requests,
          sessions: new InMemorySessionStore(),
          tenants: new InMemoryTenantRepository([seed]),
          orders: new InMemoryOrderRepository(),
          eventBus: new InMemoryEventBus(),
          dedupe: new InMemoryDedupeStore(),
        },
      }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  await app.init();
  return { app, sender, conversations, requests, orders: app.get(OrderService), tenantId: seed.tenant.id };
}

/** A customer who messaged `minutesAgo` minutes ago, with one placed order. */
async function placeOrder(h: Harness, waId: string, minutesAgo: number) {
  const customer = await h.conversations.upsertCustomer(h.tenantId, waId, "Sara");
  const conversation = await h.conversations.getOrCreateOpenConversation(h.tenantId, customer.id, "channel_seed");
  await h.conversations.touchInbound(conversation.id, new Date(Date.now() - minutesAgo * 60_000));
  const cart = addItem(emptyCart("AED"), { offeringId: "it_fries", title: "Fries", quantity: 2, unitPriceMinor: 1200, modifiers: [] });
  return h.orders.place({ tenantId: h.tenantId, customerId: customer.id, conversationId: conversation.id, cart, fulfillmentType: "pickup" });
}

describe("merchant API", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  const server = () => h.app.getHttpServer();
  const login = async () => {
    const res = await request(server()).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };

  it("serves a landing page at the root", async () => {
    const res = await request(server()).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("ordr");
  });

  it("rejects bad credentials and unauthenticated requests", async () => {
    expect((await request(server()).post("/merchant/auth/login").send({ email: EMAIL, password: "wrong" })).status).toBe(401);
    expect((await request(server()).post("/merchant/auth/login").send({ email: "nobody@demo.test", password: PASSWORD })).status).toBe(401);
    expect((await request(server()).post("/merchant/auth/login").send({ email: "not-an-email" })).status).toBe(400);
    expect((await request(server()).get("/merchant/orders")).status).toBe(401);
    expect((await request(server()).get("/merchant/orders").set("authorization", "Bearer nonsense")).status).toBe(401);
  });

  it("logs in with a cookie and a bearer token and reports the tenant", async () => {
    const res = await request(server()).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: EMAIL, role: "owner", tenantId: h.tenantId });
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ordr_session="));
    expect(cookie).toMatch(/HttpOnly/);

    const viaCookie = await request(server()).get("/merchant/me").set("cookie", cookie!.split(";")[0]!);
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.body.tenant.name).toBe("Demo Restaurant");

    const viaBearer = await request(server()).get("/merchant/me").set("authorization", `Bearer ${res.body.token}`);
    expect(viaBearer.status).toBe(200);
  });

  it("lists orders with customer details and allowed events, and transitions them", async () => {
    const token = await login();
    const auth = { authorization: `Bearer ${token}` };

    const empty = await request(server()).get("/merchant/orders").set(auth);
    expect(empty.status).toBe(200);
    expect(empty.body.orders).toEqual([]);
    expect(empty.body.states.initial).toBe("placed");

    const order = await placeOrder(h, "971500000001", 5);
    const list = await request(server()).get("/merchant/orders").set(auth);
    expect(list.body.orders).toHaveLength(1);
    expect(list.body.orders[0]).toMatchObject({
      id: order.id,
      number: 1,
      status: "placed",
      customer: { name: "Sara", waId: "971500000001" },
      allowedEvents: ["accept", "reject", "cancel"],
      isTerminal: false,
    });

    const accepted = await request(server()).post(`/merchant/orders/${order.id}/transition`).set(auth).send({ event: "accept" });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ status: "accepted", allowedEvents: ["start", "cancel"] });

    const bad = await request(server()).post(`/merchant/orders/${order.id}/transition`).set(auth).send({ event: "deliver" });
    expect(bad.status).toBe(409);
    expect((await request(server()).post(`/merchant/orders/nope/transition`).set(auth).send({ event: "accept" })).status).toBe(404);
    expect((await request(server()).get(`/merchant/orders/nope`).set(auth)).status).toBe(404);

    const detail = await request(server()).get(`/merchant/orders/${order.id}`).set(auth);
    expect(detail.body.items[0]).toMatchObject({ title: "Fries", quantity: 2 });
  });

  it("messages the customer on WhatsApp when the status changes inside the 24h window", async () => {
    const token = await login();
    const order = await placeOrder(h, "971500000001", 5);
    await request(server()).post(`/merchant/orders/${order.id}/transition`).set("authorization", `Bearer ${token}`).send({ event: "accept" });
    const sent = h.sender.to("971500000001");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(sent[0])).toContain("Order #1 is *confirmed*");
    const outbound = h.conversations.messages.filter((m) => m.direction === "out");
    expect(outbound).toHaveLength(1);
  });

  it("skips the notification outside the 24h window when no template is approved", async () => {
    const token = await login();
    const order = await placeOrder(h, "971500000002", 25 * 60);
    const res = await request(server()).post(`/merchant/orders/${order.id}/transition`).set("authorization", `Bearer ${token}`).send({ event: "accept" });
    expect(res.status).toBe(200);
    expect(h.sender.to("971500000002")).toHaveLength(0);
  });

  it("lists conversations, shows threads, lets agents reply inside the window and hands the thread to a human", async () => {
    const token = await login();
    const auth = { authorization: `Bearer ${token}` };
    await placeOrder(h, "971500000001", 5);
    const closedCustomer = await placeOrder(h, "971500000009", 30 * 60);

    const list = await request(server()).get("/merchant/conversations").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.conversations).toHaveLength(2);
    const open = list.body.conversations.find((c: { customer: { waId: string } }) => c.customer.waId === "971500000001");
    expect(open).toMatchObject({ status: "bot", windowOpen: true, customer: { name: "Sara" } });

    // The customer asked for a person: the thread shows the open request until someone replies.
    await h.requests.create({ tenantId: h.tenantId, conversationId: open.id, customerId: open.customer.id, reason: "wants a refund", preview: "I want a refund" });
    const waiting = (await request(server()).get("/merchant/conversations").set(auth)).body.conversations.find((c: { id: string }) => c.id === open.id);
    expect(waiting.openRequest).toMatchObject({ reason: "wants a refund", preview: "I want a refund", alerts: 1 });
    expect(waiting.status).toBe("bot");

    // Typing holds the bot briefly (204, no body); replying resolves the request and does not silence the bot.
    expect((await request(server()).post(`/merchant/conversations/${open.id}/typing`).set(auth)).status).toBe(204);
    expect((await h.conversations.findConversationById(open.id))?.staffTypingUntil?.getTime()).toBeGreaterThan(Date.now());
    await h.conversations.recordMessage({ tenantId: h.tenantId, conversationId: open.id, direction: "in", providerMessageId: "wamid.in.refund", kind: "text", payload: { kind: "text", text: "I want a refund" }, createdAt: new Date() });
    const inbound = (await request(server()).get(`/merchant/conversations/${open.id}`).set(auth)).body.messages.find((m: { direction: string }) => m.direction === "in");
    const reply = await request(server()).post(`/merchant/conversations/${open.id}/messages`).set(auth).send({ text: "On its way!", replyToMessageId: inbound.id });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ direction: "out", kind: "text", preview: "On its way!", quoted: { id: inbound.id, direction: "in", preview: inbound.preview } });
    expect(h.sender.to("971500000001").at(-1)).toMatchObject({ type: "text", text: { body: "On its way!" }, context: { message_id: expect.stringMatching(/^wamid\./) } });

    const thread = await request(server()).get(`/merchant/conversations/${open.id}`).set(auth);
    expect(thread.body.conversation).toMatchObject({ status: "bot" });
    expect(thread.body.conversation.openRequest).toBeUndefined();
    expect(thread.body.messages.at(-1)).toMatchObject({ direction: "out", preview: "On its way!", quoted: { direction: "in" } });
    expect(await h.requests.findOpen(open.id)).toBeNull();
    expect((await request(server()).post(`/merchant/conversations/${open.id}/messages`).set(auth).send({ text: "x", replyToMessageId: "nope" })).status).toBe(404);

    // Resolve without replying (handled by phone), and explicit take over / hand back still work.
    await h.requests.create({ tenantId: h.tenantId, conversationId: open.id, customerId: open.customer.id, reason: "parking" });
    const resolved = await request(server()).post(`/merchant/conversations/${open.id}/requests/resolve`).set(auth);
    expect(resolved.status).toBe(200);
    expect(resolved.body.openRequest).toBeUndefined();
    expect((await h.requests.findOpen(open.id))).toBeNull();
    const taken = await request(server()).post(`/merchant/conversations/${open.id}/status`).set(auth).send({ status: "human" });
    expect(taken.body.status).toBe("human");
    const back = await request(server()).post(`/merchant/conversations/${open.id}/status`).set(auth).send({ status: "bot" });
    expect(back.body.status).toBe("bot");

    const closed = list.body.conversations.find((c: { id: string }) => c.id === closedCustomer.conversationId);
    expect(closed.windowOpen).toBe(false);
    expect((await request(server()).post(`/merchant/conversations/${closed.id}/messages`).set(auth).send({ text: "hi" })).status).toBe(409);
    expect((await request(server()).get(`/merchant/conversations/nope`).set(auth)).status).toBe(404);
    expect((await request(server()).post(`/merchant/conversations/${open.id}/messages`).set(auth).send({ text: "" })).status).toBe(400);
  });

  it("uses an approved template outside the 24h window once templates are submitted", async () => {
    const token = await login();
    const auth = { authorization: `Bearer ${token}` };
    const before = await request(server()).get("/merchant/templates").set(auth);
    expect(before.body).toMatchObject({ templates: [], languages: ["en", "ar"] });

    // The fake Meta API approves immediately, so one submit is enough here.
    const submitted = await request(server()).post("/merchant/templates/submit").set(auth);
    expect(submitted.status).toBe(200);
    expect(submitted.body.templates.map((t: { language: string; status: string }) => `${t.language}:${t.status}`)).toEqual(["en:approved", "ar:approved", "en:approved", "ar:approved", "en:approved", "ar:approved"]);

    const order = await placeOrder(h, "971500000003", 25 * 60);
    await request(server()).post(`/merchant/orders/${order.id}/transition`).set(auth).send({ event: "accept" });
    const sent = h.sender.to("971500000003");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "template", template: { name: "ordr_order_status", language: { code: "en" } } });
    expect(JSON.stringify(sent[0])).toContain("confirmed");
  });
});

describe("catalog photos", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it("uploads a JPEG, serves it publicly, and the catalog item can point at it", async () => {
    const server = h.app.getHttpServer();
    const token = (await request(server).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD }).expect(200)).body.token as string;
    const auth = { authorization: `Bearer ${token}` };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
    const up = await request(server).post("/merchant/media").set(auth).send({ dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` }).expect(201);
    expect(up.body).toMatchObject({ mimeType: "image/jpeg", sizeBytes: jpeg.byteLength });
    expect(up.body.url).toMatch(/^http:\/\/localhost:3001\/v1\/media\/media_/);
    const served = await request(server).get(`/v1/media/${up.body.id}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(served.headers["content-type"]).toContain("image/jpeg");
    expect(served.headers["cache-control"]).toContain("immutable");
    expect((served.body as Buffer).equals(jpeg)).toBe(true);
    await request(server).post("/merchant/media").set(auth).send({ dataUrl: "data:text/plain;base64,aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=" }).expect(400);
    await request(server).post("/merchant/media").send({ dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` }).expect(401);
    await request(server).get("/v1/media/nope").expect(404);

    const catalog = await request(server).get("/merchant/catalog").set(auth).expect(200);
    const item = catalog.body.offerings[0];
    const updated = await request(server).patch(`/merchant/catalog/offerings/${item.id}`).set(auth).send({ imageUrl: up.body.url }).expect(200);
    expect(updated.body.imageUrl).toBe(up.body.url);
  });
});
