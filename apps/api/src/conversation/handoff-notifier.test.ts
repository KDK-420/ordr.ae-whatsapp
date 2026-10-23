import { FakeSender } from "@ordr/whatsapp";
import { describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryEventBus, InMemoryOutboxStore } from "../adapters/memory-catalog";
import { FakeTemplateApi, InMemoryTemplateRepository } from "../adapters/templates";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OutboxRelay } from "../events/outbox-relay";
import { TemplateService } from "../templates/template.service";
import type { HandedOverPayload } from "./conversation.service";
import { HandoffNotifier, handoffNumbers } from "./handoff-notifier";

const HOUR = 60 * 60_000;
const STAFF_IN_WINDOW = "971501111111";
const STAFF_COLD = "971502222222";

/** A tenant with the seed placeholder number and a real one, like production. */
async function setup(numbers: unknown = [`+${STAFF_IN_WINDOW}`, STAFF_COLD]) {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon", SEED_PHONE_NUMBER_ID: "000000000000000", SEED_ACCESS_TOKEN: "replace-me", PUBLIC_BASE_URL: "https://app.ordr.ae/" });
  const seed = seedTenantFromConfig(config);
  seed.tenant.settings.handoffNumbers = numbers;
  const tenants = new InMemoryTenantRepository([seed]);
  const real = { ...seed.channel, id: "ch_real", phoneNumberId: "1445158248675072", displayPhone: "+971 50 939 7420", accessToken: "EAA-system-user-token" };
  tenants.add({ tenant: seed.tenant, channel: real });
  const outbox = new InMemoryOutboxStore();
  const bus = new InMemoryEventBus();
  const conversations = new InMemoryConversationRepository();
  const sender = new FakeSender();
  const templateApi = new FakeTemplateApi();
  const templates = new TemplateService(new InMemoryTemplateRepository(), templateApi, tenants);
  new HandoffNotifier(config, bus, tenants, conversations, sender, templates).onModuleInit();
  const relay = new OutboxRelay(config, outbox, bus);

  // The first staff member wrote to the business an hour ago; the second never did.
  const staff = await conversations.upsertCustomer(seed.tenant.id, STAFF_IN_WINDOW, "Sara");
  const staffThread = await conversations.getOrCreateOpenConversation(seed.tenant.id, staff.id, real.id);
  await conversations.touchInbound(staffThread.id, new Date(Date.now() - HOUR));

  const customer = await conversations.upsertCustomer(seed.tenant.id, "971585884950", "Sunil");
  const thread = await conversations.getOrCreateOpenConversation(seed.tenant.id, customer.id, real.id);
  const payload: HandedOverPayload = { conversationId: thread.id, customerId: customer.id, customerName: "Sunil", waId: "971585884950", channelId: real.id, preview: "I want to talk to a person about my refund", reason: "customer asks for a refund" };
  const handedOver = () => bus.publish({ id: `evt_${Math.random()}`, type: "conversation.handed_over", tenantId: seed.tenant.id, occurredAt: new Date().toISOString(), subject: { kind: "conversation", id: thread.id }, payload });
  return { seed, real, templates, templateApi, sender, handedOver, relay, payload };
}

describe("HandoffNotifier", () => {
  it("texts staff inside the window and uses the template outside it, from the customer's channel", async () => {
    const h = await setup();
    h.templateApi.statusForNew = "APPROVED";
    await h.templates.submitDefaults(h.seed.tenant.id, ["en", "ar"]);

    await h.handedOver();
    expect(h.sender.sent).toHaveLength(2);

    const [warm, cold] = h.sender.sent;
    expect(warm?.target).toEqual({ phoneNumberId: "1445158248675072", accessToken: "EAA-system-user-token", to: STAFF_IN_WINDOW });
    expect(warm?.message.type).toBe("text");
    const body = warm?.message.type === "text" ? warm.message.text.body : "";
    expect(body).toContain('Sunil (+971585884950) needs a person: "I want to talk to a person about my refund".');
    expect(body).toContain("Reason: customer asks for a refund");
    expect(body).toContain("Reply in the inbox: https://app.ordr.ae/inbox");

    expect(cold?.target.to).toBe(STAFF_COLD);
    expect(cold?.target.phoneNumberId).toBe("1445158248675072");
    expect(cold?.message).toMatchObject({
      type: "template",
      template: {
        name: "ordr_handoff_alert",
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Sunil (+971585884950)" }, { type: "text", text: "I want to talk to a person about my refund" }, { type: "text", text: "https://app.ordr.ae/inbox" }] }],
      },
    });
  });

  it("skips a cold number when no template is approved, still texting the warm one", async () => {
    const h = await setup();
    await h.handedOver();
    expect(h.sender.sent.map((s) => s.target.to)).toEqual([STAFF_IN_WINDOW]);
  });

  it("does nothing without configured numbers", async () => {
    const h = await setup([]);
    await h.handedOver();
    expect(h.sender.sent).toHaveLength(0);
  });

  it("fails the event when a send fails, so the outbox relay retries", async () => {
    const h = await setup();
    h.sender.send = async () => {
      throw new Error("(#131030) recipient not in allowed list");
    };
    await expect(h.handedOver()).rejects.toThrow("recipient");
  });

  it("normalises the handoffNumbers setting", () => {
    expect(handoffNumbers({ handoffNumbers: ["+971 50 111 1111", "971501111111", 42, "12", "971502222222", "1", "2", "3", "4", "5", "6"] })).toEqual(["971501111111", "971502222222"]);
    expect(handoffNumbers({})).toEqual([]);
  });
});
