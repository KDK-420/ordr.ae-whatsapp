import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender, fixtures, type OutboundMessage, parseWebhook } from "@ordr/whatsapp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository } from "../src/adapters/memory";
import type { Assistant, DraftReplyInput, InterpretInput, PickOptionInput } from "../src/ai/assistant";
import { InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { loadConfig } from "../src/config";
import { ConversationService } from "../src/conversation/conversation.service";
import { SchedulingService } from "../src/scheduling/scheduling.service";

/** Tuesday 20 Oct 2026, 10:00 in Dubai. */
const NOW = new Date("2026-10-20T06:00:00Z");

function bodyOf(m: OutboundMessage | undefined): string {
  if (!m) return "";
  if (m.type === "text") return m.text.body;
  if (m.type === "interactive" && "body" in m.interactive) return m.interactive.body.text;
  return m.type;
}

function rowsOf(m: OutboundMessage | undefined): Array<{ id: string; title: string; description?: string }> {
  if (m?.type === "interactive" && m.interactive.type === "list") return m.interactive.action.sections.flatMap((s) => s.rows);
  return [];
}

/** Stands in for Claude: answers from a script and records what it was asked. */
class ScriptedAssistant implements Assistant {
  readonly enabled = true;
  readonly interpretCalls: InterpretInput[] = [];
  readonly pickCalls: PickOptionInput[] = [];
  flows = new Map<string, string>();
  replies = new Map<string, string>();
  picks = new Map<string, string>();
  async interpret(input: InterpretInput) {
    this.interpretCalls.push(input);
    return { flow: this.flows.get(input.text) ?? null, reply: this.replies.get(input.text) ?? null, confidence: "high" as const };
  }
  async pickOption(input: PickOptionInput) {
    this.pickCalls.push(input);
    return this.picks.get(input.text) ?? null;
  }
  async draftReply(_input: DraftReplyInput) {
    return "draft";
  }
}

describe("salon booking over WhatsApp", () => {
  let app: INestApplication;
  let sender: FakeSender;
  let orders: InMemoryOrderRepository;
  let service: ConversationService;
  let assistant: ScriptedAssistant;
  const base = { phoneNumberId: "200000000000000", from: "971500000001", profileName: "Noor" };

  beforeEach(async () => {
    const config = loadConfig({
      META_APP_SECRET: "test-app-secret",
      META_VERIFY_TOKEN: "test-verify-token",
      STORAGE: "memory",
      WHATSAPP_SENDER: "log",
      SEED_PHONE_NUMBER_ID: base.phoneNumberId,
      SEED_BLUEPRINT_ID: "salon",
      SEED_TENANT_NAME: "Demo Salon",
    });
    sender = new FakeSender();
    orders = new InMemoryOrderRepository();
    assistant = new ScriptedAssistant();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register({
          config,
          overrides: {
            sender,
            orders,
            conversations: new InMemoryConversationRepository(),
            sessions: new InMemorySessionStore(),
            tenants: new InMemoryTenantRepository([seedTenantFromConfig(config)]),
            eventBus: new InMemoryEventBus(),
            dedupe: new InMemoryDedupeStore(),
            assistant,
          },
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    app.get(SchedulingService).now = () => NOW;
    service = app.get(ConversationService);
  });
  afterEach(async () => {
    await app.close();
  });

  async function send(payload: ReturnType<typeof fixtures.textMessageWebhook>) {
    for (const ev of parseWebhook(payload)) await service.handleEvent(ev);
  }
  const last = () => sender.to(base.from).at(-1);

  it("books a haircut with anyone available and then cancels it", async () => {
    await send(fixtures.textMessageWebhook("hi", base));
    expect(bodyOf(last())).toBe("Welcome to Demo Salon! What would you like to do?");

    await send(fixtures.buttonReplyWebhook("book", "Book appointment", base));
    expect(bodyOf(last())).toBe("Which service would you like?");
    expect(rowsOf(last())[0]).toEqual({ id: "svc_haircut", title: "Haircut", description: "AED 80.00 · 45 min" });

    await send(fixtures.listReplyWebhook("svc_haircut", "Haircut", base));
    expect(rowsOf(last()).map((r) => r.id)).toEqual(["any", "res_sara", "res_mona"]);

    await send(fixtures.listReplyWebhook("any", "Anyone available", base));
    expect(bodyOf(last())).toBe("Which day suits you?");
    expect(rowsOf(last())[0]).toEqual({ id: "2026-10-20", title: "Tue 20 Oct" });

    await send(fixtures.listReplyWebhook("2026-10-20", "Tue 20 Oct", base));
    expect(bodyOf(last())).toBe("Tue 20 Oct: what time of day?");

    await send(fixtures.buttonReplyWebhook("morning", "Morning", base));
    const slots = rowsOf(last());
    expect(slots.map((r) => r.title)).toEqual(["11:00", "11:30"]);
    expect(slots[0]!.description).toBe("Sara");

    await send(fixtures.listReplyWebhook(slots[0]!.id, "11:00", base));
    expect(bodyOf(last())).toBe("Haircut with Anyone available on Tue 20 Oct at 11:00. Shall we book it?");

    await send(fixtures.buttonReplyWebhook("confirm", "Book it", base));
    expect(bodyOf(last())).toBe("Booked! Haircut with Sara on Tue 20 Oct, 11:00. Total AED 80.00. We will confirm shortly and remind you before your visit.");
    expect(orders.orders).toHaveLength(1);
    expect(orders.orders[0]).toMatchObject({ kind: "booking", status: "requested", resourceId: "res_sara", scheduledAt: "2026-10-20T07:00:00.000Z", durationMinutes: 45 });

    await send(fixtures.textMessageWebhook("bookings", base));
    expect(bodyOf(last())).toBe("Your upcoming bookings:");
    const mine = rowsOf(last());
    expect(mine[0]).toMatchObject({ id: orders.orders[0]!.id, title: "Tue 20 Oct, 11:00", description: "Haircut · Sara · requested and waiting for confirmation" });

    await send(fixtures.listReplyWebhook(mine[0]!.id, mine[0]!.title, base));
    await send(fixtures.buttonReplyWebhook("cancel", "Cancel booking", base));
    expect(bodyOf(last())).toBe("Your booking on Tue 20 Oct, 11:00 has been cancelled.");
    expect(orders.orders[0]!.status).toBe("cancelled");

    await send(fixtures.textMessageWebhook("bookings", base));
    expect(bodyOf(last())).toContain("no upcoming bookings");
  });

  it("recovers when the chosen time is taken meanwhile", async () => {
    await send(fixtures.textMessageWebhook("hi", base));
    await send(fixtures.buttonReplyWebhook("book", "Book appointment", base));
    await send(fixtures.listReplyWebhook("svc_manicure", "Manicure", base));
    await send(fixtures.listReplyWebhook("res_sara", "Sara", base));
    await send(fixtures.listReplyWebhook("2026-10-20", "Tue 20 Oct", base));
    await send(fixtures.buttonReplyWebhook("morning", "Morning", base));
    const slot = rowsOf(last())[0]!;
    await send(fixtures.listReplyWebhook(slot.id, slot.title, base));

    // Someone else takes Sara's 11:00 before this customer confirms.
    const scheduling = app.get(SchedulingService);
    await scheduling.book({ tenantId: "tenant_seed", customerId: "someone", offeringId: "svc_manicure", resourceId: "res_sara", startAt: new Date(slot.id.split("|")[0]!), language: "en" });

    await send(fixtures.buttonReplyWebhook("confirm", "Book it", base));
    const bodies = sender.to(base.from).map(bodyOf);
    expect(bodies.at(-2)).toBe("Sorry, that time was just taken. Let's pick another.");
    expect(bodies.at(-1)).toBe("Which day suits you?");
    expect(orders.orders).toHaveLength(1);
  });

  it("lets the assistant route free text into a flow and onto the shown options", async () => {
    assistant.flows.set("I'd like to get my hair cut tomorrow", "book_service");
    assistant.picks.set("the hair cut one", "svc_haircut");
    assistant.picks.set("whoever is free", "any");

    await send(fixtures.textMessageWebhook("I'd like to get my hair cut tomorrow", base));
    expect(bodyOf(last())).toBe("Which service would you like?");
    const asked = assistant.interpretCalls[0]!;
    expect(asked.knowledge.services.map((s) => s.id)).toContain("svc_haircut");
    expect(asked.knowledge.staff.map((s) => s.title)).toEqual(["Sara", "Mona"]);
    expect(asked.knowledge.intents.map((i) => i.flow)).toEqual(expect.arrayContaining(["book_service", "my_bookings", "talk_to_us"]));
    expect(asked.knowledge.intents.find((i) => i.flow === "my_bookings")?.keywords).toContain("bookings");

    await send(fixtures.textMessageWebhook("the hair cut one", base));
    expect(bodyOf(last())).toBe("Haircut: who would you like it with?");
    expect(assistant.pickCalls[0]).toMatchObject({ prompt: "Which service would you like?", options: expect.arrayContaining([expect.objectContaining({ id: "svc_haircut" })]) });

    await send(fixtures.textMessageWebhook("whoever is free", base));
    expect(bodyOf(last())).toBe("Which day suits you?");

    // Text the assistant cannot place falls back to the question's own retry prompt.
    await send(fixtures.textMessageWebhook("hmm", base));
    const bodies = sender.to(base.from).map(bodyOf);
    expect(bodies.at(-1)).toBe("Which day suits you?");
    expect(bodies.at(-2)).toMatch(/choose|pick|option/i);
  });

  it("answers a question from tenant facts without starting a flow", async () => {
    assistant.replies.set("do you have parking?", "Yes, there is free parking behind the building.");
    await send(fixtures.textMessageWebhook("do you have parking?", base));
    expect(sender.to(base.from).map(bodyOf)).toEqual(["Yes, there is free parking behind the building."]);
    // The next message gets the menu as usual.
    await send(fixtures.textMessageWebhook("ok", base));
    expect(bodyOf(last())).toBe("Welcome to Demo Salon! What would you like to do?");
  });
});
