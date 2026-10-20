import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender } from "@ordr/whatsapp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository } from "../src/adapters/memory";
import { InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import type { AgentInput, AgentReply, ConversationAgent } from "../src/ai/agent";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { loadConfig } from "../src/config";
import { MemoryService } from "../src/memory/memory.service";
import { DemoAwareSender } from "../src/simulator/simulator.service";
import type { AgentRunRepository, TenantRepository } from "../src/ports";
import { TOKENS } from "../src/tokens";

/** Stands in for Claude: replies from a script, records what it was given. */
class ScriptedAgent implements ConversationAgent {
  readonly enabled = true;
  readonly calls: AgentInput[] = [];
  next: AgentReply | Error = { text: "Hi! How can I help?", handoff: false, trace: { model: "test", tools: [], memoryIds: [], inputTokens: 1, outputTokens: 1, durationMs: 1 } };
  async reply(input: AgentInput): Promise<AgentReply> {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

describe("web chat", () => {
  let app: INestApplication;
  let sender: FakeSender;
  let agent: ScriptedAgent;
  let conversations: InMemoryConversationRepository;
  let tenants: InMemoryTenantRepository;
  let runs: AgentRunRepository;
  let memory: MemoryService;
  let repo: TenantRepository;

  beforeEach(async () => {
    const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", WHATSAPP_SENDER: "log", SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon", SEED_PHONE_NUMBER_ID: "200000000000000" });
    sender = new FakeSender();
    agent = new ScriptedAgent();
    conversations = new InMemoryConversationRepository();
    tenants = new InMemoryTenantRepository([seedTenantFromConfig(config)]);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register({ config, overrides: { sender: new DemoAwareSender(sender), agent, conversations, tenants, orders: new InMemoryOrderRepository(), sessions: new InMemorySessionStore(), eventBus: new InMemoryEventBus(), dedupe: new InMemoryDedupeStore() } })],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.init();
    runs = app.get(TOKENS.AgentRunRepository);
    memory = app.get(MemoryService);
    repo = app.get(TOKENS.TenantRepository);
  });
  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it("starts an anonymous session by slug, chats through the same agent as WhatsApp, persists both sides and records the run", async () => {
    const start = await http().post("/v1/chat/sessions").send({ slug: "seed" }).expect(201);
    expect(start.body).toMatchObject({ tenant: { name: "Demo Salon", slug: "seed", blueprintId: "salon" }, status: "bot", messages: [] });
    expect(typeof start.body.token).toBe("string");
    expect(JSON.stringify(start.body)).not.toMatch(/9715|accessToken/);
    const { sessionId, token } = start.body as { sessionId: string; token: string };

    const reply = await http().post(`/v1/chat/sessions/${sessionId}/messages`).set("authorization", `Bearer ${token}`).send({ text: "hi", clientMessageId: "m1" }).expect(200);
    expect(reply.body.messages.map((m: { role: string; text: string }) => `${m.role}:${m.text}`)).toEqual(["customer:hi", "assistant:Hi! How can I help?"]);
    expect(agent.calls[0]).toMatchObject({ channel: "web", text: "hi", tenant: { slug: "seed" }, inboundMessageId: `web:${sessionId}:m1`, memories: [], consent: null, recentOrders: [] });
    expect(agent.calls[0]!.customer.waId).toMatch(/^web:/);
    // The visitor is a customer of this tenant only, with no phone number.
    expect(await conversations.findCustomerById(agent.calls[0]!.customer.id)).toMatchObject({ tenantId: "tenant_seed", name: "Web visitor" });
    // Nothing was sent to WhatsApp.
    expect(sender.sent).toHaveLength(0);
    // The run is on record with its channel.
    expect(await runs.listForConversation("tenant_seed", agent.calls[0]!.conversationId)).toMatchObject([{ channel: "web", outcome: "replied", model: "test" }]);

    // Retrying the same client message id does not run the agent twice.
    await http().post(`/v1/chat/sessions/${sessionId}/messages`).set("authorization", `Bearer ${token}`).send({ text: "hi", clientMessageId: "m1" }).expect(200);
    expect(agent.calls).toHaveLength(1);

    // The thread is readable with the token and keeps history.
    agent.next = { text: "Tomorrow at 15:00?", handoff: false };
    await http().post(`/v1/chat/sessions/${sessionId}/messages`).set("authorization", `Bearer ${token}`).send({ text: "haircut tomorrow" }).expect(200);
    const thread = await http().get(`/v1/chat/sessions/${sessionId}`).set("authorization", `Bearer ${token}`).expect(200);
    expect(thread.body.messages).toHaveLength(4);
    expect(agent.calls[1]!.history.map((h) => h.text)).toEqual(["hi", "Hi! How can I help?", "haircut tomorrow"]);
  });

  it("rejects missing, wrong and cross-session tokens, and unknown businesses", async () => {
    await http().post("/v1/chat/sessions").send({ slug: "nope" }).expect(404);
    const a = (await http().post("/v1/chat/sessions").send({ slug: "seed" }).expect(201)).body as { sessionId: string; token: string };
    const b = (await http().post("/v1/chat/sessions").send({ slug: "seed" }).expect(201)).body as { sessionId: string; token: string };
    await http().get(`/v1/chat/sessions/${a.sessionId}`).expect(401);
    await http().get(`/v1/chat/sessions/${a.sessionId}`).set("authorization", "Bearer wrong").expect(401);
    await http().get(`/v1/chat/sessions/${a.sessionId}`).set("authorization", `Bearer ${b.token}`).expect(401);
    await http().post(`/v1/chat/sessions/${a.sessionId}/messages`).set("authorization", `Bearer ${a.token}`).send({ text: "" }).expect(400);
  });

  it("keeps tenants apart: a session is bound to its business, memories and history never cross", async () => {
    const other = await repo.create({ name: "Other Shop", slug: "other", blueprintId: "retail" });
    const a = (await http().post("/v1/chat/sessions").send({ slug: "seed" }).expect(201)).body as { sessionId: string; token: string };
    const b = (await http().post("/v1/chat/sessions").send({ slug: "other" }).expect(201)).body as { sessionId: string; token: string; tenant: { blueprintId: string } };
    expect(b.tenant.blueprintId).toBe("retail");
    await http().post(`/v1/chat/sessions/${a.sessionId}/messages`).set("authorization", `Bearer ${a.token}`).send({ text: "hello from A" }).expect(200);
    await http().post(`/v1/chat/sessions/${b.sessionId}/messages`).set("authorization", `Bearer ${b.token}`).send({ text: "hello from B" }).expect(200);
    expect(agent.calls.map((c) => [c.tenant.id, c.text])).toEqual([["tenant_seed", "hello from A"], [other.id, "hello from B"]]);
    expect(agent.calls[1]!.history.map((h) => h.text)).toEqual(["hello from B"]);

    // A memory consented at tenant A is invisible at tenant B, even for the same customer id.
    const customerA = agent.calls[0]!.customer;
    const tenantA = (await repo.findById("tenant_seed"))!;
    await memory.setConsent(tenantA, customerA.id, true);
    await memory.remember(tenantA, customerA.id, { kind: "preference", key: "preferred_staff", value: "Sara" });
    expect(await memory.recall(tenantA, customerA.id)).toMatchObject([{ key: "preferred_staff" }]);
    expect(await memory.recall(other, customerA.id)).toEqual([]);
    await http().post(`/v1/chat/sessions/${a.sessionId}/messages`).set("authorization", `Bearer ${a.token}`).send({ text: "again" }).expect(200);
    expect(agent.calls[2]!.memories.map((m) => m.key)).toEqual(["preferred_staff"]);
    expect(agent.calls[2]!.consent?.memory).toBe(true);
  });

  it("memory off for the tenant: no memories, no consent prompt, and writes are refused", async () => {
    await tenants.updateSettings("tenant_seed", { memoryEnabled: false });
    const a = (await http().post("/v1/chat/sessions").send({ slug: "seed" }).expect(201)).body as { sessionId: string; token: string };
    await http().post(`/v1/chat/sessions/${a.sessionId}/messages`).set("authorization", `Bearer ${a.token}`).send({ text: "hi" }).expect(200);
    expect(agent.calls[0]!.consent).toBeUndefined();
    const tenant = (await repo.findById("tenant_seed"))!;
    await expect(memory.remember(tenant, agent.calls[0]!.customer.id, { kind: "preference", key: "x", value: "y" })).rejects.toMatchObject({ code: "disabled" });
  });

  it("withdrawing consent deletes what was stored; a handoff marks the thread for a person", async () => {
    const a = (await http().post("/v1/chat/sessions").send({ slug: "seed" }).expect(201)).body as { sessionId: string; token: string };
    await http().post(`/v1/chat/sessions/${a.sessionId}/messages`).set("authorization", `Bearer ${a.token}`).send({ text: "hi" }).expect(200);
    const tenant = (await repo.findById("tenant_seed"))!;
    const customerId = agent.calls[0]!.customer.id;
    await memory.setConsent(tenant, customerId, true);
    await memory.remember(tenant, customerId, { kind: "fact", key: "shoe_size", value: "42" });
    await memory.setConsent(tenant, customerId, false);
    expect(await memory.recall(tenant, customerId)).toEqual([]);
    expect((await memory.consent(tenant.id, customerId))?.memory).toBe(false);

    agent.next = { text: "A colleague will take it from here.", handoff: true };
    const res = await http().post(`/v1/chat/sessions/${a.sessionId}/messages`).set("authorization", `Bearer ${a.token}`).send({ text: "I want a person" }).expect(200);
    expect(res.body.status).toBe("human");
    expect(res.body.messages.at(-1).text).toBe("A colleague will take it from here.");
  });
});
