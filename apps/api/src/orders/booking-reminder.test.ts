import { getBlueprint } from "@ordr/blueprints";
import { FakeSender } from "@ordr/whatsapp";
import { describe, expect, it } from "vitest";
import { demoSalonCatalog } from "../actions/demo-salon";
import { InMemoryConversationRepository, InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore, InMemoryResourceRepository } from "../adapters/memory-catalog";
import { FakeTemplateApi, InMemoryTemplateRepository } from "../adapters/templates";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OutboxRelay } from "../events/outbox-relay";
import { formatWhen } from "../scheduling/format";
import { SchedulingService } from "../scheduling/scheduling.service";
import { BOOKING_REMINDER_PURPOSE, TemplateService } from "../templates/template.service";
import { BookingReminderNotifier, reminderEventId } from "./booking-reminder";
import { OrderService } from "./order.service";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * The notifier judges "already started" and the 24h window against the real clock, so the
 * appointment is a few days ahead of now: 15:00 Dubai on the first day Sara works (any day but Sunday).
 */
function upcomingAppointment(): Date {
  const d = new Date(Date.now() + 3 * DAY);
  d.setUTCHours(11, 0, 0, 0);
  while (d.getUTCDay() === 0) d.setTime(d.getTime() + DAY);
  return d;
}

async function setup() {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon", SEED_PHONE_NUMBER_ID: "200000000000000" });
  const seed = seedTenantFromConfig(config);
  const demo = demoSalonCatalog(seed.tenant.id);
  const tenants = new InMemoryTenantRepository([seed]);
  const orders = new InMemoryOrderRepository();
  const outbox = new InMemoryOutboxStore();
  const bus = new InMemoryEventBus();
  const conversations = new InMemoryConversationRepository();
  const sender = new FakeSender();
  const templates = new TemplateService(new InMemoryTemplateRepository(), new FakeTemplateApi(), tenants);
  const orderService = new OrderService(orders, tenants, { get: getBlueprint }, bus, outbox);
  const scheduling = new SchedulingService(new InMemoryCatalogRepository(demo.categories, demo.offerings), new InMemoryResourceRepository(demo.resources), orders, { get: getBlueprint }, orderService);
  const notifier = new BookingReminderNotifier(bus, orders, tenants, conversations, sender, templates);
  notifier.onModuleInit();
  const relay = new OutboxRelay(config, outbox, bus);
  const customer = await conversations.upsertCustomer(seed.tenant.id, "971500000001", "Noor");
  const conversation = await conversations.getOrCreateOpenConversation(seed.tenant.id, customer.id, seed.channel.id);
  const appointment = upcomingAppointment();
  const book = (offeringId: string, startAt: Date, language = "en") =>
    scheduling.book({ tenantId: seed.tenant.id, customerId: customer.id, conversationId: conversation.id, offeringId, resourceId: "res_sara", startAt, language });
  return { tenantId: seed.tenant.id, scheduling, orders, outbox, relay, sender, conversations, templates, customer, conversation, orderService, appointment, book };
}

const templateParams = (m: { type: string; template?: { components?: Array<Record<string, unknown>> } } | undefined): string[] =>
  ((m?.template?.components?.[0] as { parameters?: Array<{ text: string }> } | undefined)?.parameters ?? []).map((p) => p.text);

describe("booking reminders", () => {
  it("queues a reminder per lead time when a booking is placed, due ahead of the appointment", async () => {
    const h = await setup();
    const { order } = await h.book("svc_haircut", h.appointment);
    const reminders = h.outbox.rows.filter((r) => r.type === "booking.reminder");
    expect(reminders.map((r) => r.id)).toEqual([reminderEventId(order.id, 1440), reminderEventId(order.id, 120)]);
    expect(reminders.map((r) => r.nextAttemptAt)).toEqual([h.appointment.getTime() - DAY, h.appointment.getTime() - 2 * HOUR]);
    expect(reminders[0]!.payload).toMatchObject({ leadMinutes: 1440, scheduledAt: h.appointment.toISOString() });
    // Not due yet: the relay leaves them alone.
    expect(await h.relay.tick(new Date())).toBe(0);
  });

  it("skips lead times that are already in the past for a same-day booking", async () => {
    const h = await setup();
    const inThreeHours = new Date(Date.now() + 3 * HOUR);
    const offering = { id: "svc_haircut", tenantId: h.tenantId, type: "service" as const, name: { en: "Haircut" }, priceMinor: 8000, currency: "AED", sortOrder: 1, isActive: true, modifierGroups: [] };
    const order = await h.orderService.placeBooking({ tenantId: h.tenantId, customerId: h.customer.id, offering, title: "Haircut", resourceId: "res_sara", startAt: inThreeHours, durationMinutes: 45, fulfillmentType: "in_store", blockingStatuses: ["requested", "confirmed"] });
    expect(h.outbox.rows.filter((r) => r.type === "booking.reminder").map((r) => r.id)).toEqual([reminderEventId(order.id, 120)]);
  });

  it("sends the reminder when due: text inside the 24h window, an approved template outside it, nothing without one", async () => {
    const h = await setup();
    await h.book("svc_haircut", h.appointment);
    const when = formatWhen(h.appointment, "Asia/Dubai", "en");

    // 24h reminder: the customer wrote an hour ago, so plain text is allowed.
    await h.conversations.touchInbound(h.conversation.id, new Date(Date.now() - HOUR));
    expect(await h.relay.tick(new Date(h.appointment.getTime() - DAY))).toBe(1);
    const first = h.sender.to("971500000001").at(-1);
    expect(first && first.type === "text" ? first.text.body : first).toBe(`Reminder: your booking at Demo Salon is on ${when}. Reply here if you need to change it.`);
    expect((await h.conversations.listMessages(h.conversation.id)).at(-1)).toMatchObject({ direction: "out", kind: "text" });

    // 2h reminder: the customer's last message is older than a day and no template is approved, so nothing goes out.
    await h.conversations.touchInbound(h.conversation.id, new Date(Date.now() - 25 * HOUR));
    expect(await h.relay.tick(new Date(h.appointment.getTime() - 2 * HOUR))).toBe(1);
    expect(h.sender.to("971500000001")).toHaveLength(1);
    expect(await h.outbox.counts()).toEqual({ sent: 2 });

    // With an approved template the same situation sends it, in the customer's language.
    const later = new Date(h.appointment.getTime() + HOUR);
    await h.conversations.setCustomerLanguage(h.customer.id, "ar");
    await h.book("svc_manicure", later, "ar");
    await h.templates.submitDefaults(h.tenantId, ["en", "ar"]);
    await h.templates.sync(h.tenantId);
    expect(await h.templates.approved(h.tenantId, BOOKING_REMINDER_PURPOSE, "ar")).toBeTruthy();
    expect(await h.relay.tick(new Date(later.getTime() - DAY))).toBe(1);
    const tpl = h.sender.to("971500000001").at(-1);
    expect(tpl && tpl.type === "template" ? tpl.template : tpl).toMatchObject({ name: "ordr_booking_reminder", language: { code: "ar" } });
    expect(templateParams(tpl)).toEqual(["Demo Salon", formatWhen(later, "Asia/Dubai", "ar")]);
  });

  it("sends nothing for a booking that was cancelled meanwhile", async () => {
    const h = await setup();
    const { order } = await h.book("svc_haircut", h.appointment);
    await h.conversations.touchInbound(h.conversation.id, new Date(Date.now() - HOUR));
    await h.scheduling.cancel(h.tenantId, h.customer.id, order.id);
    expect(await h.relay.tick(new Date(h.appointment.getTime() - DAY))).toBe(1);
    expect(h.sender.to("971500000001")).toHaveLength(0);
    expect(await h.outbox.counts()).toMatchObject({ sent: 1 });
  });
});
