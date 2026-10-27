import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender, fixtures, type OutboundMessage, parseWebhook } from "@ordr/whatsapp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository } from "../src/adapters/memory";
import { InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import type { AgentInput, AgentReply, ConversationAgent } from "../src/ai/agent";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { loadConfig } from "../src/config";
import { ConversationService } from "../src/conversation/conversation.service";

const bodyOf = (m: OutboundMessage | undefined): string => (!m ? "" : m.type === "text" ? m.text.body : m.type === "interactive" && "body" in m.interactive ? m.interactive.body.text : m.type);

/** Stands in for Claude: replies from a script, records what it was given. */
class ScriptedAgent implements ConversationAgent {
  readonly enabled = true;
  readonly calls: AgentInput[] = [];
  next: AgentReply | Error = { text: "Hi! How can I help?", handoff: false };
  async reply(input: AgentInput): Promise<AgentReply> {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

describe("natural conversation style", () => {
  let app: INestApplication;
  let sender: FakeSender;
  let agent: ScriptedAgent;
  let conversations: InMemoryConversationRepository;
  let service: ConversationService;
  const base = { phoneNumberId: "200000000000000", from: "971500000001", profileName: "Noor" };

  beforeEach(async () => {
    const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", WHATSAPP_SENDER: "log", SEED_PHONE_NUMBER_ID: base.phoneNumberId, SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon" });
    sender = new FakeSender();
    agent = new ScriptedAgent();
    conversations = new InMemoryConversationRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register({
          config,
          overrides: { sender, agent, conversations, orders: new InMemoryOrderRepository(), sessions: new InMemorySessionStore(), tenants: new InMemoryTenantRepository([seedTenantFromConfig(config)]), eventBus: new InMemoryEventBus(), dedupe: new InMemoryDedupeStore() },
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    service = app.get(ConversationService);
  });
  afterEach(async () => {
    await app.close();
  });

  const send = async (payload: ReturnType<typeof fixtures.textMessageWebhook>) => {
    for (const ev of parseWebhook(payload)) await service.handleEvent(ev);
  };
  const last = () => sender.to(base.from).at(-1);

  it("answers free text through the agent with the thread as history, and taps go in as words", async () => {
    await send(fixtures.textMessageWebhook("hi", base));
    expect(bodyOf(last())).toBe("Hi! How can I help?");
    expect(agent.calls[0]).toMatchObject({ text: "hi", language: "en", tenant: { name: "Demo Salon" }, customer: { waId: base.from, name: "Noor" } });
    expect(agent.calls[0]!.knowledge.services.map((s) => s.id)).toContain("svc_haircut");

    agent.next = { text: "Sure, tomorrow at 15:00 with Sara?", handoff: false };
    await send(fixtures.textMessageWebhook("haircut tomorrow afternoon", base));
    expect(bodyOf(last())).toBe("Sure, tomorrow at 15:00 with Sara?");
    // The history the agent saw ends with the new message, preceded by the earlier exchange.
    expect(agent.calls[1]!.history.map((h) => `${h.role}:${h.text}`)).toEqual(["customer:hi", "bot:Hi! How can I help?", "customer:haircut tomorrow afternoon"]);

    agent.next = { text: "Booked!", handoff: false };
    await send(fixtures.buttonReplyWebhook("yes", "Yes please", base));
    expect(agent.calls[2]!.text).toBe("Yes please");
    expect((await conversations.listMessages(agent.calls[2]!.conversationId)).at(-1)?.direction).toBe("out");
  });

  it("a handoff opens a request and the agent keeps answering, told about the open request and its own number", async () => {
    agent.next = { text: "I've passed the valet question to the team; meanwhile, anything else?", handoff: true, handoffReason: "valet service question" };
    await send(fixtures.textMessageWebhook("do you have valet?", base));
    expect(bodyOf(last())).toContain("passed the valet question");
    const [conv] = await conversations.listConversations("tenant_seed");
    expect(conv?.status).toBe("bot");
    expect(agent.calls[0]?.openRequest).toBeUndefined();
    expect(agent.calls[0]?.businessNumber).toBe("+971500000000");

    agent.next = { text: "We open 10:00 to 20:00. Your valet question is still with the team.", handoff: false };
    await send(fixtures.textMessageWebhook("tell me your working hours", base));
    expect(bodyOf(last())).toContain("10:00 to 20:00");
    expect(agent.calls[1]?.openRequest).toMatchObject({ reason: "valet service question", sinceMinutes: 0 });
    expect(agent.calls).toHaveLength(2);
  });

  it("falls back to the guided menu when the model fails", async () => {
    agent.next = new Error("overloaded");
    await send(fixtures.textMessageWebhook("hi", base));
    expect(bodyOf(last())).toBe("Welcome to Demo Salon! What would you like to do?");
  });
});
