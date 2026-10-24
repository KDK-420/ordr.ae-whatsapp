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

  it("hands the thread to a person when the agent asks, then acknowledges the customer instead of calling the model", async () => {
    agent.next = { text: "A colleague will reply here shortly.", handoff: true };
    await send(fixtures.textMessageWebhook("I want to talk to someone", base));
    expect(bodyOf(last())).toBe("A colleague will reply here shortly.");
    const [conv] = await conversations.listConversations("tenant_seed");
    expect(conv?.status).toBe("human");
    await send(fixtures.textMessageWebhook("hello?", base));
    expect(sender.to(base.from)).toHaveLength(2);
    expect(bodyOf(last())).toContain("your message has reached our team");
    expect(agent.calls).toHaveLength(1);
    // Waiting too long: the agent is back, with an apology first.
    const record = [...conversations.conversations.values()][0]!;
    record.handedOverAt = new Date(Date.now() - 2 * 60 * 60_000);
    agent.next = { text: "Back with you. What can I do?", handoff: false };
    await send(fixtures.textMessageWebhook("anyone?", base));
    expect(sender.to(base.from).slice(-2).map(bodyOf)).toEqual([expect.stringContaining("Sorry for the wait"), "Back with you. What can I do?"]);
    expect(agent.calls).toHaveLength(2);
    expect((await conversations.listConversations("tenant_seed"))[0]?.status).toBe("bot");
  });

  it("'hi' or 'menu' while a person owns the thread brings the agent back for good, not for one message", async () => {
    agent.next = { text: "A colleague will reply here shortly.", handoff: true };
    await send(fixtures.textMessageWebhook("I need a human", base));
    expect((await conversations.listConversations("tenant_seed"))[0]?.status).toBe("human");
    agent.next = { text: "Hi again! What can I do for you?", handoff: false };
    await send(fixtures.textMessageWebhook("Hi", base));
    expect(bodyOf(last())).toBe("Hi again! What can I do for you?");
    expect((await conversations.listConversations("tenant_seed"))[0]?.status).toBe("bot");
    // The follow-up is answered by the agent too, not swallowed.
    agent.next = { text: "We offer haircuts, colour, manicures and pedicures.", handoff: false };
    await send(fixtures.textMessageWebhook("ok let's understand available services", base));
    expect(bodyOf(last())).toBe("We offer haircuts, colour, manicures and pedicures.");
    expect(agent.calls).toHaveLength(3);
  });

  it("falls back to the guided menu when the model fails", async () => {
    agent.next = new Error("overloaded");
    await send(fixtures.textMessageWebhook("hi", base));
    expect(bodyOf(last())).toBe("Welcome to Demo Salon! What would you like to do?");
  });
});
