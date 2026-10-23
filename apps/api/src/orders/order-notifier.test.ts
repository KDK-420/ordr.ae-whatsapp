import { getBlueprint } from "@ordr/blueprints";
import { FakeSender } from "@ordr/whatsapp";
import { describe, expect, it } from "vitest";
import { demoSalonCatalog } from "../actions/demo-salon";
import { InMemoryConversationRepository, InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryBookingHoldRepository } from "../adapters/memory-commerce";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore, InMemoryResourceRepository } from "../adapters/memory-catalog";
import { FakeTemplateApi, InMemoryTemplateRepository } from "../adapters/templates";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OutboxRelay } from "../events/outbox-relay";
import { SchedulingService } from "../scheduling/scheduling.service";
import { TemplateService } from "../templates/template.service";
import { OrderNotifier } from "./order-notifier";
import { OrderService } from "./order.service";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function upcomingAppointment(): Date {
  const d = new Date(Date.now() + 3 * DAY);
  d.setUTCHours(11, 0, 0, 0);
  while (d.getUTCDay() === 0) d.setTime(d.getTime() + DAY);
  return d;
}

/**
 * A tenant whose seed placeholder number was never retired and then got a real number assigned,
 * which is exactly how production looked when the first confirmation failed to send.
 */
async function setup() {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon", SEED_PHONE_NUMBER_ID: "000000000000000", SEED_ACCESS_TOKEN: "replace-me" });
  const seed = seedTenantFromConfig(config);
  const demo = demoSalonCatalog(seed.tenant.id);
  const tenants = new InMemoryTenantRepository([seed]);
  const real = { ...seed.channel, id: "ch_real", phoneNumberId: "1445158248675072", displayPhone: "+971 50 939 7420", accessToken: "EAA-system-user-token" };
  tenants.add({ tenant: seed.tenant, channel: real });
  const orders = new InMemoryOrderRepository();
  const outbox = new InMemoryOutboxStore();
  const bus = new InMemoryEventBus();
  const conversations = new InMemoryConversationRepository();
  const sender = new FakeSender();
  const templates = new TemplateService(new InMemoryTemplateRepository(), new FakeTemplateApi(), tenants);
  const orderService = new OrderService(orders, tenants, { get: getBlueprint }, bus, outbox);
  const scheduling = new SchedulingService(new InMemoryCatalogRepository(demo.categories, demo.offerings), new InMemoryResourceRepository(demo.resources), orders, { get: getBlueprint }, orderService, new InMemoryBookingHoldRepository(orders), config);
  new OrderNotifier(bus, orders, tenants, conversations, sender, templates).onModuleInit();
  const relay = new OutboxRelay(config, outbox, bus);
  const customer = await conversations.upsertCustomer(seed.tenant.id, "971585884950", "Sunil");
  return { seed, real, tenants, scheduling, orderService, relay, sender, conversations, customer };
}

describe("OrderNotifier", () => {
  it("confirms on the number the customer wrote to, not the tenant's oldest channel", async () => {
    const h = await setup();
    // The customer's thread lives on the real number.
    const conversation = await h.conversations.getOrCreateOpenConversation(h.seed.tenant.id, h.customer.id, h.real.id);
    await h.conversations.touchInbound(conversation.id, new Date(Date.now() - HOUR));
    const { order } = await h.scheduling.book({ tenantId: h.seed.tenant.id, customerId: h.customer.id, conversationId: conversation.id, offeringId: "svc_haircut", resourceId: "res_sara", startAt: upcomingAppointment(), language: "en" });
    await h.relay.tick(new Date());
    h.sender.sent.length = 0;

    // Status changes reach the notifier through the bus (the outbox relay plays that role in production).
    await h.orderService.transition(h.seed.tenant.id, order.id, "confirm", "staff:owner");
    await h.relay.tick(new Date());
    expect(h.sender.sent).toHaveLength(1);
    const sent = h.sender.sent.at(-1);
    expect(sent?.target).toEqual({ phoneNumberId: "1445158248675072", accessToken: "EAA-system-user-token", to: "971585884950" });
    expect(sent?.message.type === "text" ? sent.message.text.body : sent?.message).toContain("confirmed");
  });

  it("falls back to the tenant's newest active channel when the order has no thread", async () => {
    const h = await setup();
    expect((await h.tenants.findContextById(h.seed.tenant.id))?.channel.phoneNumberId).toBe("1445158248675072");
    expect(await h.tenants.findContextByChannelId("ch_real")).toMatchObject({ channel: { phoneNumberId: "1445158248675072" } });
    expect(await h.tenants.findContextByChannelId("ch_missing")).toBeNull();
  });
});
