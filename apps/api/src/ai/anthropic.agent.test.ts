import { getBlueprint, salon } from "@ordr/blueprints";
import { describe, expect, it } from "vitest";
import { demoSalonCatalog } from "../actions/demo-salon";
import { InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore, InMemoryResourceRepository } from "../adapters/memory-catalog";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OrderService } from "../orders/order.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { AnthropicAgent } from "./anthropic.agent";
import type { TenantKnowledge } from "./assistant";

/** Tuesday 20 Oct 2026, 10:00 in Dubai. */
const NOW = new Date("2026-10-20T06:00:00Z");

function setup() {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon" });
  const seed = seedTenantFromConfig(config);
  const demo = demoSalonCatalog(seed.tenant.id);
  const orders = new InMemoryOrderRepository();
  const orderService = new OrderService(orders, new InMemoryTenantRepository([seed]), { get: getBlueprint }, new InMemoryEventBus(), new InMemoryOutboxStore());
  const scheduling = new SchedulingService(new InMemoryCatalogRepository(demo.categories, demo.offerings), new InMemoryResourceRepository(demo.resources), orders, { get: getBlueprint }, orderService);
  scheduling.now = () => NOW;
  const knowledge: TenantKnowledge = { tenantName: "Demo Salon", blueprintId: "salon", timezone: "Asia/Dubai", services: [], staff: [], intents: [], facts: ["Free parking behind the building."] };
  const input = { tenant: seed.tenant, blueprint: salon, customer: { id: "c1", tenantId: seed.tenant.id, waId: "971500000001", name: "Noor" }, conversationId: "conv1", language: "en", knowledge };
  return { scheduling, orders, input, tenantId: seed.tenant.id };
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
    const agent = new AnthropicAgent(h.scheduling, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const reply = await agent.reply({ ...h.input, text: "can I get a haircut this afternoon?", history: [{ role: "customer", text: "hi" }, { role: "bot", text: "Hi Noor! How can I help?" }] });
    expect(reply).toEqual({ text: "I can do 12:00 or 12:30 today with Sara. Which one?", handoff: false, startFlow: undefined });
    expect(api.requests).toHaveLength(2);
    const first = api.requests[0]!;
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.fallbacks).toBe("default");
    expect((first.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["list_services", "list_staff", "available_days", "available_times", "book_appointment", "my_bookings", "cancel_booking", "hand_over_to_human"]);
    expect(JSON.stringify(first.system)).toContain("Free parking behind the building.");
    expect(JSON.stringify(first.system)).toContain("2026-10-20 = Tue 20 Oct (today)");
    expect(first.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hi Noor! How can I help?" },
      { role: "user", content: "can I get a haircut this afternoon?" },
    ]);
    expect(api.toolResults()[0]).toMatch(/^12:00 with Sara \(staff_id res_sara\)\n12:30 with Sara/);

    // The customer agrees; the model books the 12:00 slot. The booking exists with the data from the engine.
    const api2 = fakeApi([
      { tool: { name: "book_appointment", input: { service_id: "svc_haircut", date: "2026-10-20", time: "12:00", staff_id: "any" } } },
      { text: "Done! Haircut with Sara today at 12:00, AED 80." },
    ]);
    const agent2 = new AnthropicAgent(h.scheduling, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl });
    const booked = await agent2.reply({ ...h.input, text: "12:00 please", history: [] });
    expect(booked.text).toContain("Done!");
    expect(api2.toolResults()[0]).toMatch(/^Booked\. Booking number 1, Haircut with Sara on Tue 20 Oct, 12:00, total AED 80\.00/);
    expect(h.orders.orders[0]).toMatchObject({ kind: "booking", resourceId: "res_sara", scheduledAt: "2026-10-20T08:00:00.000Z", conversationId: "conv1", customerId: "c1" });

    // Booking the same time again is refused by the engine, and the model is told to offer alternatives.
    const api3 = fakeApi([{ tool: { name: "book_appointment", input: { service_id: "svc_haircut", date: "2026-10-20", time: "12:00", staff_id: "res_sara" } } }, { text: "Sorry, 12:00 just went." }]);
    const agent3 = new AnthropicAgent(h.scheduling, { apiKey: "k", model: "claude-opus-5-5", fetch: api3.fetchImpl });
    await agent3.reply({ ...h.input, text: "book 12 with Sara", history: [] });
    expect(api3.toolResults()[0]).toMatch(/not available/);
    expect(h.orders.orders).toHaveLength(1);
  });

  it("reports a handoff when the model calls for a person, and lists and cancels bookings", async () => {
    const h = setup();
    const api = fakeApi([{ tool: { name: "hand_over_to_human", input: { reason: "wants to reschedule" } } }, { text: "Sure, someone from the team will reply here shortly." }]);
    const agent = new AnthropicAgent(h.scheduling, { apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const reply = await agent.reply({ ...h.input, text: "can I move my appointment to Friday?", history: [] });
    expect(reply).toMatchObject({ handoff: true, text: "Sure, someone from the team will reply here shortly." });

    await h.scheduling.book({ tenantId: h.tenantId, customerId: "c1", offeringId: "svc_manicure", resourceId: "any", startAt: new Date("2026-10-21T08:00:00Z"), language: "en" });
    const api2 = fakeApi([{ tool: { name: "my_bookings", input: {} } }, { tool: { name: "cancel_booking", input: { booking_id: h.orders.orders[0]!.id } } }, { text: "Cancelled your manicure on Wed 21 Oct at 12:00." }]);
    const agent2 = new AnthropicAgent(h.scheduling, { apiKey: "k", model: "claude-opus-5-5", fetch: api2.fetchImpl });
    const cancelled = await agent2.reply({ ...h.input, text: "cancel my manicure please", history: [] });
    expect(cancelled.handoff).toBe(false);
    expect(api2.toolResults()[0]).toMatch(/#1 Manicure on Wed 21 Oct, 12:00, requested/);
    expect(api2.toolResults()[1]).toMatch(/^Cancelled booking #1/);
    expect(h.orders.orders[0]!.status).toBe("cancelled");
  });

  it("surfaces API failures so the caller can fall back to the menu", async () => {
    const h = setup();
    const failing: typeof fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529 });
    const agent = new AnthropicAgent(h.scheduling, { apiKey: "k", model: "claude-opus-5-5", fetch: failing });
    await expect(agent.reply({ ...h.input, text: "hi", history: [] })).rejects.toBeTruthy();
  });
});
