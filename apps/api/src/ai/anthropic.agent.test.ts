import { getBlueprint, salon } from "@ordr/blueprints";
import { describe, expect, it } from "vitest";
import { demoSalonCatalog } from "../actions/demo-salon";
import { InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryBookingHoldRepository } from "../adapters/memory-commerce";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore, InMemoryResourceRepository } from "../adapters/memory-catalog";
import { InMemoryCartRepository, InMemoryMemoryRepository, InMemoryPaymentIntentRepository, InMemoryWebhookReceiptRepository } from "../adapters/memory-commerce";
import { CommerceService } from "../commerce/commerce.service";
import { MemoryService } from "../memory/memory.service";
import { MockPaymentProvider } from "../payments/payment-provider";
import { demoRetailCatalog } from "../actions/demo-retail";
import { retail } from "@ordr/blueprints";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OrderService } from "../orders/order.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { resort } from "@ordr/blueprints";
import { setupStays } from "../stays/stay.service.test";
import { AnthropicAgent } from "./anthropic.agent";
import type { TenantKnowledge } from "./assistant";

/** Tuesday 20 Oct 2026, 10:00 in Dubai. */
const NOW = new Date("2026-10-20T06:00:00Z");

function setup() {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon" });
  const seed = seedTenantFromConfig(config);
  const demo = demoSalonCatalog(seed.tenant.id);
  const orders = new InMemoryOrderRepository();
  const holds = new InMemoryBookingHoldRepository(orders);
  orders.holds = holds;
  const orderService = new OrderService(orders, new InMemoryTenantRepository([seed]), { get: getBlueprint }, new InMemoryEventBus(), new InMemoryOutboxStore());
  const scheduling = new SchedulingService(new InMemoryCatalogRepository(demo.categories, demo.offerings), new InMemoryResourceRepository(demo.resources), orders, { get: getBlueprint }, orderService, holds, config);
  scheduling.now = () => NOW;
  const memories = new InMemoryMemoryRepository();
  const memory = new MemoryService(config, memories);
  const knowledge: TenantKnowledge = { tenantName: "Demo Salon", blueprintId: "salon", timezone: "Asia/Dubai", services: [], staff: [], intents: [], facts: ["Free parking behind the building."], profile: { address: "Indigo Tower, Cluster D, JLT", mapsUrl: "https://maps.app.goo.gl/demo", phone: "+971 4 000 0000", hours: "Sat–Thu 10:00–21:00" } };
  const input = { tenant: seed.tenant, blueprint: salon, customer: { id: "c1", tenantId: seed.tenant.id, waId: "971500000001", name: "Noor" }, conversationId: "conv1", language: "en", knowledge, channel: "whatsapp" as const, memories: [], consent: null, recentOrders: [] };
  const deps = { scheduling, memory };
  return { scheduling, orders, holds, memory, memories, deps, input, tenantId: seed.tenant.id };
}

function setupShop() {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "retail", SEED_TENANT_NAME: "Demo Shop" });
  const seed = seedTenantFromConfig(config);
  const demo = demoRetailCatalog(seed.tenant.id);
  const catalog = new InMemoryCatalogRepository(demo.categories, demo.offerings);
  const orders = new InMemoryOrderRepository();
  const holds = new InMemoryBookingHoldRepository(orders);
  const orderService = new OrderService(orders, new InMemoryTenantRepository([seed]), { get: getBlueprint }, new InMemoryEventBus(), new InMemoryOutboxStore());
  const scheduling = new SchedulingService(catalog, new InMemoryResourceRepository([]), orders, { get: getBlueprint }, orderService, holds, config);
  const intents = new InMemoryPaymentIntentRepository();
  const commerce = new CommerceService(config, catalog, new InMemoryCartRepository(), orders, intents, new InMemoryWebhookReceiptRepository(), new MockPaymentProvider("secret-secret-secret", "http://localhost:3001"), { get: getBlueprint }, new InMemoryEventBus(), orderService);
  const knowledge: TenantKnowledge = { tenantName: "Demo Shop", blueprintId: "retail", timezone: "Asia/Dubai", services: [], staff: [], intents: [], facts: [] };
  const input = { tenant: seed.tenant, blueprint: retail, customer: { id: "c9", tenantId: seed.tenant.id, waId: "web:abc", name: "Omar" }, conversationId: "conv9", language: "en", knowledge, channel: "web" as const, memories: [], consent: undefined, recentOrders: [] };
  return { commerce, orders, intents, catalog, deps: { scheduling, commerce }, input, tenantId: seed.tenant.id };
}

type Turn = { tool?: { name: string; input: Record<string, unknown> }; text?: string; stop?: string };

/** Answers each API call from a script; records the requests and the tool results the runner sends back. */
function fakeApi(script: Turn[]) {
  const requests: Array<Record<string, unknown>> = [];
  let n = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push(body);
    const turn = script[n++] ?? { text: "(script exhausted)" };
    const content = turn.tool ? [{ type: "tool_use", id: `toolu_${n}`, name: turn.tool.name, input: turn.tool.input }] : [{ type: "text", text: turn.text ?? "" }];
    const message = { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: turn.stop ?? (turn.tool ? "tool_use" : "end_turn"), stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  };
  /** Tool results in order, read from the last request (which carries the whole exchange). */
  const toolResults = () =>
    ((requests.at(-1)?.messages ?? []) as Array<{ role: string; content: unknown }>).flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<{ type: string; content?: string }>).filter((b) => b.type === "tool_result").map((b) => b.content ?? "") : []));
  return { fetchImpl, requests, toolResults };
}

describe("AnthropicAgent", () => {
  it("checks availability through the tool, books on agreement and returns the model's words", async () => {
    const h = setup();
    const api = fakeApi([
      { tool: { name: "available_times", input: { service_id: "svc_haircut", date: "2026-10-20", staff_id: "any", period: "afternoon" } } },
      { text: "I can do 12:00 or 12:30 today with Sara. Which one?" },
    ]);
    const agent = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const reply = await agent.reply({ ...h.input, text: "can I get a haircut this afternoon?", history: [{ role: "customer", text: "hi" }, { role: "bot", text: "Hi Noor! How can I help?" }] });
    expect(reply).toMatchObject({ text: "I can do 12:00 or 12:30 today with Sara. Which one?", handoff: false, startFlow: undefined });
    expect(reply.trace).toMatchObject({ model: "claude-opus-5-5", inputTokens: 20, outputTokens: 10, tools: [{ name: "available_times", ok: true, input: { service_id: "svc_haircut" } }] });
    expect(api.requests).toHaveLength(2);
    const first = api.requests[0]!;
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.fallbacks).toBe("default");
    expect((first.tools as Array<{ name: string }>).map((t) => t.name)).toEqual([
      "list_services",
      "list_staff",
      "available_days",
      "available_times",
      "hold_slot",
      "confirm_booking",
      "release_hold",
      "my_bookings",
      "reschedule_booking",
      "cancel_booking",
      "record_memory_consent",
      "remember",
      "forget",
      "what_you_remember",
      "hand_over_to_human",
    ]);
    expect(JSON.stringify(first.system)).toContain("has not been asked about memory");
    // At low effort the model thinks out loud in text blocks before a tool call, and once in a while that note ends up in
    // the reply. Forbidding it did not stop it; giving it a customer-safe form did (see anthropic.agent.ts systemPrompt).
    expect(JSON.stringify(first.system)).toContain("sent to the customer word for word");
    expect(JSON.stringify(first.system)).toContain("Free parking behind the building.");
    expect(JSON.stringify(first.system)).toContain("- Address: Indigo Tower, Cluster D, JLT");
    expect(JSON.stringify(first.system)).toContain("- Phone: +971 4 000 0000");
    expect(JSON.stringify(first.system)).toContain("2026-10-20 = Tue 20 Oct (today)");
    expect(first.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hi Noor! How can I help?" },
      { role: "user", content: "can I get a haircut this afternoon?" },
    ]);
    expect(api.toolResults()[0]).toMatch(/^12:00 with Sara \(staff_id res_sara\)\n12:30 with Sara/);

    // The customer picks 12:00: the model holds it, restates, and on "yes" confirms. The booking carries the engine's data.
    const api2 = fakeApi([
      { tool: { name: "hold_slot", input: { service_id: "svc_haircut", date: "2026-10-20", time: "12:00", staff_id: "any" } } },
      { text: "Haircut with Sara today at 12:00, AED 80. Shall I confirm?" },
    ]);
    const agent2 = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl });
    const held = await agent2.reply({ ...h.input, text: "12:00 please", history: [] });
    expect(held.text).toContain("Shall I confirm?");
    expect(api2.toolResults()[0]).toMatch(/^Held \(hold_id hold_\d+\) until 10:10: Haircut with Sara on Tue 20 Oct, 12:00, AED 80\.00/);
    const holdId = /hold_id (hold_\d+)/.exec(api2.toolResults()[0]!)![1]!;
    expect(h.holds.holds[0]).toMatchObject({ id: holdId, status: "held", resourceId: "res_sara", customerId: "c1" });

    // While held, the slot is gone for everybody else but still free for this customer.
    expect((await h.scheduling.slots(h.tenantId, "svc_haircut", "res_sara", "2026-10-20")).map((s) => s.startAt.toISOString())).not.toContain("2026-10-20T08:00:00.000Z");
    expect((await h.scheduling.slots(h.tenantId, "svc_haircut", "res_sara", "2026-10-20", { forCustomerId: "c1" })).map((s) => s.startAt.toISOString())).toContain("2026-10-20T08:00:00.000Z");

    const api3 = fakeApi([{ tool: { name: "confirm_booking", input: { hold_id: holdId } } }, { text: "Done! Haircut with Sara today at 12:00, AED 80." }]);
    const agent3 = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api3.fetchImpl });
    const booked = await agent3.reply({ ...h.input, text: "yes", history: [] });
    expect(booked.text).toContain("Done!");
    expect(api3.toolResults()[0]).toMatch(/^Booked\. Booking number 1, Haircut with Sara on Tue 20 Oct, 12:00, total AED 80\.00/);
    expect(h.orders.orders[0]).toMatchObject({ kind: "booking", resourceId: "res_sara", scheduledAt: "2026-10-20T08:00:00.000Z", conversationId: "conv1", customerId: "c1", source: "whatsapp" });
    expect(h.holds.holds[0]!.status).toBe("confirmed");

    // Holding the same time again is refused by the engine, and the model is told to offer alternatives.
    const api4 = fakeApi([{ tool: { name: "hold_slot", input: { service_id: "svc_haircut", date: "2026-10-20", time: "12:00", staff_id: "res_sara" } } }, { text: "Sorry, 12:00 just went." }]);
    const agent4 = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api4.fetchImpl });
    const refused = await agent4.reply({ ...h.input, customer: { ...h.input.customer, id: "c2" }, text: "book 12 with Sara", history: [] });
    expect(api4.toolResults()[0]).toMatch(/not available/);
    expect(refused.trace?.tools[0]).toMatchObject({ name: "hold_slot", ok: true });
    expect(h.orders.orders).toHaveLength(1);

    // A stale hold id cannot be confirmed, and never by another customer.
    const api5 = fakeApi([{ tool: { name: "confirm_booking", input: { hold_id: holdId } } }, { text: "Hmm." }]);
    const agent5 = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api5.fetchImpl });
    const stale = await agent5.reply({ ...h.input, customer: { ...h.input.customer, id: "c2" }, text: "yes", history: [] });
    expect(api5.toolResults()[0]).toMatch(/^Not possible: no such hold/);
    expect(stale.trace?.tools[0]).toMatchObject({ name: "confirm_booking", ok: false });
  });

  it("puts a sent photo on the user turn as an image block, with the caption as text", async () => {
    const h = setup();
    const api = fakeApi([{ text: "That is our balayage, AED 350. Want a time?" }]);
    const agent = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const data = Buffer.from("not really a jpeg").toString("base64");
    await agent.reply({ ...h.input, text: "can you do this?", attachments: [{ kind: "image", mimeType: "image/jpeg", data }], history: [{ role: "customer", text: "hi" }, { role: "bot", text: "Hi Noor!" }, { role: "customer", text: "can you do this?" }] });
    const messages = api.requests[0]!.messages as Array<{ role: string; content: unknown }>;
    // The stored turn for this message is replaced, not duplicated.
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
        { type: "text", text: "can you do this?" },
      ],
    });
    expect(JSON.stringify(api.requests[0]!.system)).toContain("[sent a voice note]");
  });

  it("sells through commerce tools on a retail tenant: search, cart, checkout link, and stock is checked", async () => {
    const h = setupShop();
    const api = fakeApi([
      { tool: { name: "search_products", input: { query: "coffee", max_price: 100 } } },
      { tool: { name: "add_to_cart", input: { product_id: "prd_ethiopia", variant_id: "var_eth_250", quantity: 2 } } },
      { tool: { name: "checkout", input: {} } },
      { text: "Two bags of Ethiopia, AED 130. Pay here: (link)" },
    ]);
    const agent = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const reply = await agent.reply({ ...h.input, text: "two bags of your floral coffee please, and I'll pay now", history: [] });
    expect((api.requests[0]!.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["search_products", "product_details", "view_cart", "add_to_cart", "remove_from_cart", "checkout", "my_orders", "hand_over_to_human"]);
    expect(JSON.stringify(api.requests[0]!.system)).toContain("website chat assistant");
    const results = api.toolResults();
    expect(results[0]).toMatch(/^prd_ethiopia: Ethiopia Yirgacheffe from AED 65\.00 .* variants: var_eth_250=250 g AED 65\.00 \(12 left\)/);
    expect(results[0]).toContain("prd_decaf: Decaf Brazil from AED 50.00 SOLD OUT");
    expect(results[0]).not.toContain("Cloud Runner");
    expect(results[1]).toMatch(/^Added\.\n2 x Ethiopia Yirgacheffe \(250 g\) = AED 130\.00/);
    expect(results[2]).toMatch(/^Order #1 created for AED 130\.00\. Payment link: http:\/\/localhost:3001\/pay\/[0-9a-f-]+ \(valid until/);
    expect(reply.trace?.tools.map((t) => t.name)).toEqual(["search_products", "add_to_cart", "checkout"]);
    expect(h.orders.orders[0]).toMatchObject({ kind: "order", status: "pending_payment", paymentStatus: "pending", source: "web", totalMinor: 13000, items: [{ offeringId: "prd_ethiopia", variantId: "var_eth_250", quantity: 2 }] });
    // Stock was reserved at checkout.
    const eth = await h.catalog.getOffering(h.tenantId, "prd_ethiopia");
    expect(eth!.variants!.find((v) => v.id === "var_eth_250")!.stock).toBe(10);

    // Asking for more than is left is refused with the number available.
    const api2 = fakeApi([{ tool: { name: "add_to_cart", input: { product_id: "prd_runner", variant_id: "var_run_41", quantity: 3 } } }, { text: "Only 2 left." }]);
    const agent2 = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl });
    await agent2.reply({ ...h.input, text: "3 pairs of the runners in 41", history: [] });
    expect(api2.toolResults()[0]).toBe("Not possible: only 2 left of Cloud Runner EU 41.");
  });

  it("sends catalog photos after the reply, with name and price as caption, and says which items have none", async () => {
    const h = setupShop();
    await h.catalog.updateOffering(h.tenantId, "prd_ethiopia", { imageUrl: "https://img.test/ethiopia.jpg" });
    const api = fakeApi([{ tool: { name: "send_photos", input: { ids: ["prd_ethiopia", "prd_colombia", "nope"] } } }, { text: "Here is our Ethiopia." }]);
    const agent = new AnthropicAgent({ ...h.deps, catalog: h.catalog }, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const reply = await agent.reply({ ...h.input, text: "show me the coffee", history: [] });
    expect((api.requests[0]!.tools as Array<{ name: string }>).map((t) => t.name)).toContain("send_photos");
    expect(api.toolResults()[0]).toBe("Photos of Ethiopia Yirgacheffe will be sent right after your message; do not describe the pictures, just refer to them. No photo for: Colombia Huila, nope.");
    expect(reply.text).toBe("Here is our Ethiopia.");
    expect(reply.media).toEqual([{ link: "https://img.test/ethiopia.jpg", caption: "*Ethiopia Yirgacheffe* · AED 65.00\nWashed, floral and citrus. Roasted this week." }]);
    // The search result marks items that have a picture.
    const api2 = fakeApi([{ tool: { name: "search_products", input: { query: "ethiopia" } } }, { text: "ok" }]);
    const agent2 = new AnthropicAgent({ ...h.deps, catalog: h.catalog }, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl });
    await agent2.reply({ ...h.input, text: "ethiopia?", history: [] });
    expect(api2.toolResults()[0]).toContain("[photo]");
  });

  it("stores memory only with consent, through the service, never sensitive details", async () => {
    const h = setup();
    // Without consent, remember is refused and nothing is stored.
    const api = fakeApi([{ tool: { name: "remember", input: { key: "preferred_staff", value: "Sara" } } }, { text: "Would you like me to remember that for next time?" }]);
    const agent = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    await agent.reply({ ...h.input, text: "I always go to Sara", history: [] });
    expect(api.toolResults()[0]).toBe("Not possible: the customer has not agreed to be remembered.");
    expect(h.memories.memories).toHaveLength(0);

    // Consent, then a preference, then a sensitive detail (refused), then forget.
    const api2 = fakeApi([
      { tool: { name: "record_memory_consent", input: { granted: true } } },
      { tool: { name: "remember", input: { key: "Preferred staff", value: "Sara", confidence: 0.95 } } },
      { tool: { name: "remember", input: { key: "note", value: "pregnant, avoid strong colour" } } },
      { text: "Noted, I'll remember Sara." },
    ]);
    const agent2 = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl });
    const reply = await agent2.reply({ ...h.input, text: "yes please", history: [], inboundMessageId: "wamid.1" });
    expect(api2.toolResults()).toEqual(["Consent recorded. You may now use remember for preferences the customer states.", 'Remembered preferred_staff = "Sara".', "Not possible: that kind of detail is not stored."]);
    expect(h.memories.memories).toHaveLength(1);
    expect(h.memories.memories[0]).toMatchObject({ tenantId: h.tenantId, customerId: "c1", key: "preferred_staff", value: "Sara", sourceMessageIds: ["wamid.1"], consentPurpose: "personalization" });
    expect(reply.trace?.memoryIds).toEqual([h.memories.memories[0]!.id]);

    // Next turn the memory is in the prompt; forgetting removes it.
    const memories = await h.memory.recall(h.input.tenant, "c1");
    const api3 = fakeApi([{ tool: { name: "forget", input: {} } }, { text: "Done, I've forgotten everything." }]);
    const agent3 = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api3.fetchImpl });
    await agent3.reply({ ...h.input, memories, consent: { tenantId: h.tenantId, customerId: "c1", memory: true, purpose: "personalization", updatedAt: "" }, text: "forget what you know about me", history: [] });
    expect(JSON.stringify(api3.requests[0]!.system)).toContain("- preferred_staff: Sara");
    expect(api3.toolResults()[0]).toBe("Forgot 1 item(s).");
    expect(await h.memory.recall(h.input.tenant, "c1")).toEqual([]);
  });

  it("reports a handoff when the model calls for a person, and lists and cancels bookings", async () => {
    const h = setup();
    const api = fakeApi([{ tool: { name: "hand_over_to_human", input: { reason: "wants to reschedule" } } }, { text: "Sure, someone from the team will reply here shortly." }]);
    const agent = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const reply = await agent.reply({ ...h.input, text: "can I move my appointment to Friday?", history: [] });
    expect(reply).toMatchObject({ handoff: true, text: "Sure, someone from the team will reply here shortly." });

    await h.scheduling.book({ tenantId: h.tenantId, customerId: "c1", offeringId: "svc_manicure", resourceId: "any", startAt: new Date("2026-10-21T08:00:00Z"), language: "en" });
    const api2 = fakeApi([{ tool: { name: "my_bookings", input: {} } }, { tool: { name: "cancel_booking", input: { booking_id: h.orders.orders[0]!.id } } }, { text: "Cancelled your manicure on Wed 21 Oct at 12:00." }]);
    const agent2 = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl });
    const cancelled = await agent2.reply({ ...h.input, text: "cancel my manicure please", history: [] });
    expect(cancelled.handoff).toBe(false);
    expect(api2.toolResults()[0]).toMatch(/#1 Manicure on Wed 21 Oct, 12:00 \(staff_id res_sara\), requested/);
    expect(api2.toolResults()[1]).toMatch(/^Cancelled booking #1/);
    expect(h.orders.orders[0]!.status).toBe("cancelled");
  });

  it("books a resort stay through the stay tools: resorts, availability, hold, confirm, with photos", async () => {
    const h = setupStays();
    const knowledge: TenantKnowledge = { tenantName: "Al Noor Resorts", blueprintId: "resort", timezone: "Asia/Dubai", services: [], staff: [], intents: [], facts: [] };
    const input = { tenant: h.seed.tenant, blueprint: resort, customer: { id: "c1", tenantId: h.tenantId, waId: "971500000001", name: "Noor" }, conversationId: "conv1", language: "en", knowledge, channel: "whatsapp" as const, memories: [], consent: undefined, recentOrders: [] };
    const deps = { stays: h.stays, catalog: h.catalog, properties: h.properties };
    const api = fakeApi([
      { tool: { name: "list_resorts", input: {} } },
      { tool: { name: "search_stays", input: { check_in: "2026-12-24", check_out: "2026-12-27", guests: 2, resort_id: "prop_hatta" } } },
      { tool: { name: "send_photos", input: { ids: ["stay_hatta_lodge", "prop_hatta"] } } },
      { text: "Hatta has a Mountain Lodge at AED 850/night, AED 2,550 for 3 nights. Shall I hold it?" },
    ]);
    const agent = new AnthropicAgent(deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const reply = await agent.reply({ ...input, text: "something in the mountains for 2, Dec 24 to 27", history: [] });
    expect((api.requests[0]!.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["list_resorts", "list_room_types", "search_stays", "hold_stay", "confirm_stay", "release_hold", "my_stays", "cancel_stay", "send_photos", "hand_over_to_human"]);
    expect(JSON.stringify(api.requests[0]!.system)).toContain("resort group");
    const results = api.toolResults();
    expect(results[0]).toContain("prop_hatta: Hatta Mountain Lodge - Hatta Dam Road, Hatta, Dubai; check-in 14:00, check-out 11:00");
    expect(results[0]).toContain("prop_fujairah");
    expect(results[1]).toMatch(/^2026-12-24 \(Thu 24 Dec\) to 2026-12-27 \(Sun 27 Dec\), 3 nights, 2 guests:\nstay_hatta_lodge: Mountain Lodge at Hatta Mountain Lodge - 10 free, AED 850\.00\/night, total AED 2,550\.00 for 3 nights \[photo\]/);
    expect(results[2]).toContain("Photos of Mountain Lodge, Hatta Mountain Lodge will be sent");
    expect(reply.media?.map((m) => m.link)).toEqual(["https://picsum.photos/seed/hatta-lodge/1200/800", "https://picsum.photos/seed/hatta-lodge-1/1200/800", "https://picsum.photos/seed/hatta-lodge-2/1200/800"]);

    const api2 = fakeApi([{ tool: { name: "hold_stay", input: { room_type_id: "stay_hatta_lodge", check_in: "2026-12-24", check_out: "2026-12-27", guests: 2 } } }, { text: "Held. Mountain Lodge, 24-27 Dec, 2 guests, AED 2,550. Name for the booking?" }]);
    const agent2 = new AnthropicAgent(deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl });
    await agent2.reply({ ...input, text: "yes hold it", history: [] });
    expect(api2.toolResults()[0]).toMatch(/^Held \(hold_id hold_\w+\) until 10:10: Mountain Lodge at Hatta Mountain Lodge, 2026-12-24 \(Thu 24 Dec\) to 2026-12-27 \(Sun 27 Dec\) \(3 nights, 2 guests\), total AED 2,550\.00 incl\. VAT\. Check-in from 14:00, check-out by 11:00\./);
    const holdId = /hold_id (hold_\w+)/.exec(api2.toolResults()[0]!)![1]!;

    const api3 = fakeApi([{ tool: { name: "confirm_stay", input: { hold_id: holdId, guests: 2, guest_name: "Noor A." } } }, { text: "Confirmed! Booking 1." }]);
    const agent3 = new AnthropicAgent(deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api3.fetchImpl });
    await agent3.reply({ ...input, text: "Noor A., yes", history: [] });
    expect(api3.toolResults()[0]).toMatch(/^Reserved\. Booking number 1: Mountain Lodge at Hatta Mountain Lodge, 2026-12-24 \(Thu 24 Dec\) to 2026-12-27 \(Sun 27 Dec\), 2 guests, total AED 2,550\.00, payment at the property\. Status: requested and waiting for confirmation\. Check-in from 14:00\. Tell the customer where to come: Address: Hatta Dam Road, Hatta, Dubai https:\/\/maps\.google\.com\/\?q=Hatta\+Dam/);
    expect(h.orders.orders[0]).toMatchObject({ kind: "stay", propertyId: "prop_hatta", guests: 2, notes: "Guest: Noor A.", scheduledAt: "2026-12-24T10:00:00.000Z", checkOutAt: "2026-12-27T07:00:00.000Z" });

    const api4 = fakeApi([{ tool: { name: "my_stays", input: {} } }, { tool: { name: "cancel_stay", input: { stay_id: h.orders.orders[0]!.id } } }, { text: "Cancelled." }]);
    const agent4 = new AnthropicAgent(deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api4.fetchImpl });
    await agent4.reply({ ...input, text: "cancel my booking", history: [] });
    expect(api4.toolResults()[0]).toMatch(/#1 Mountain Lodge · Hatta Mountain Lodge, 2026-12-24 \(Thu 24 Dec\) to 2026-12-27 \(Sun 27 Dec\), 2 guests, AED 2,550\.00/);
    expect(api4.toolResults()[1]).toMatch(/^Cancelled booking #1/);
  });

  it("tells the model about an open request for the team and about its own number", async () => {
    const h = setup();
    const api = fakeApi([{ text: "Still with the team. Anything else?" }]);
    const agent = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    await agent.reply({ ...h.input, knowledge: { ...h.input.knowledge, profile: { ...h.input.knowledge.profile, phone: "+971 50 939 7420" } }, text: "any news on the valet?", history: [], openRequest: { reason: "valet service question", sinceMinutes: 4 }, businessNumber: "+971 50 939 7420" });
    const system = (api.requests[0]!.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    expect(system).toContain('"valet service question" was passed to the team 4 minute(s) ago');
    expect(system).toContain("The customer is writing to +971 50 939 7420, which is this chat. Never tell them to call");
    // The profile phone is that same number here, so it is not offered as "how to call".
    expect(system).not.toContain("- Phone:");
    // A second hand_over while the request is open tells the model it is already with the team.
    const api3 = fakeApi([{ tool: { name: "hand_over_to_human", input: { reason: "valet service question" } } }, { text: "Still with the team." }]);
    await new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api3.fetchImpl }).reply({ ...h.input, text: "any news?", history: [], openRequest: { reason: "valet service question", sinceMinutes: 4 }, businessNumber: "+971 50 939 7420" });
    expect(api3.toolResults()[0]).toContain("The team already has this customer's request");
    const api2 = fakeApi([{ text: "Hi!" }]);
    await new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl }).reply({ ...h.input, text: "hi", history: [] });
    expect(JSON.stringify(api2.requests[0]!.system)).not.toContain("Open with the team");
  });

  it("surfaces API failures so the caller can fall back to the menu", async () => {
    const h = setup();
    const failing: typeof fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529 });
    const agent = new AnthropicAgent(h.deps, { apiKey: "k", model: "claude-opus-5-5", fetch: failing });
    await expect(agent.reply({ ...h.input, text: "hi", history: [] })).rejects.toBeTruthy();
  });
});
