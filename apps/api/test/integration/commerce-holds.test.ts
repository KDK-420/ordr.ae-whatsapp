import { SlotTakenError } from "@ordr/domain";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBookingHoldRepository, PrismaCartRepository, PrismaMemoryRepository, PrismaPaymentIntentRepository, PrismaWebhookReceiptRepository, PrismaWebSessionRepository, PrismaAgentRunRepository } from "../../src/adapters/prisma-commerce";
import { PrismaCatalogRepository, PrismaOrderRepository, PrismaResourceRepository } from "../../src/adapters/prisma-catalog";
import type { CreateBookingInput } from "../../src/ports";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let tenantId = "";
let otherTenantId = "";
const customerId = `cus_ch_${suffix}`;
const at = (iso: string) => new Date(iso);
const blocking = ["requested", "confirmed"];

function booking(resourceId: string, scheduledAt: Date, durationMinutes: number, extra: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    tenantId,
    customerId,
    kind: "booking",
    initialStatus: "requested",
    fulfillmentType: "in_store",
    source: "web",
    items: [{ offeringId: `svc_ch_${suffix}`, title: "Haircut", quantity: 1, unitPriceMinor: 8000, lineTotalMinor: 8000, modifiers: [] }],
    currency: "AED",
    subtotalMinor: 8000,
    deliveryFeeMinor: 0,
    vatMinor: 0,
    totalMinor: 8000,
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    scheduledAt,
    resourceId,
    durationMinutes,
    ...extra,
  };
}

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Commerce IT", slug: `commerce-it-${suffix}`, blueprintId: "salon" } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: "Other IT", slug: `other-it-${suffix}`, blueprintId: "retail" } })).id;
  await prisma.customer.create({ data: { id: customerId, tenantId, waId: `web:${suffix}`, name: "IT Visitor" } });
  await prisma.offering.create({ data: { id: `svc_ch_${suffix}`, tenantId, type: "service", name: { en: "Haircut" }, priceMinor: 8000, durationMinutes: 45 } });
});

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.agentRun.deleteMany({ where: { tenantId: id } });
    await prisma.memory.deleteMany({ where: { tenantId: id } });
    await prisma.customerConsent.deleteMany({ where: { tenantId: id } });
    await prisma.webSession.deleteMany({ where: { tenantId: id } });
    await prisma.webhookReceipt.deleteMany({ where: { provider: `it-${suffix}` } });
    await prisma.paymentIntent.deleteMany({ where: { tenantId: id } });
    await prisma.cart.deleteMany({ where: { tenantId: id } });
    await prisma.bookingHold.deleteMany({ where: { tenantId: id } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId: id } });
    await prisma.order.deleteMany({ where: { tenantId: id } });
    await prisma.offering.deleteMany({ where: { tenantId: id } });
    await prisma.resource.deleteMany({ where: { tenantId: id } });
    await prisma.customer.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("Prisma holds", () => {
  it("one hold per slot under the resource lock; holds block bookings by others; the owner confirms through it", async () => {
    const resources = new PrismaResourceRepository(prisma);
    const orders = new PrismaOrderRepository(prisma);
    const holds = new PrismaBookingHoldRepository(prisma);
    const sara = await resources.create(tenantId, { name: { en: "Sara" }, hours: {}, skills: [], sortOrder: 1 });
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const hold = (customer: string, start: string, end: string) => ({ tenantId, customerId: customer, offeringId: `svc_ch_${suffix}`, resourceId: sara.id, startAt: at(start), endAt: at(end), expiresAt });

    // Two concurrent holds on the same slot: exactly one wins.
    const race = await Promise.allSettled([holds.create(hold(customerId, "2030-02-04T07:00:00Z", "2030-02-04T07:55:00Z"), blocking), holds.create(hold("someone_else", "2030-02-04T07:30:00Z", "2030-02-04T08:25:00Z"), blocking)]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((r) => r.status === "rejected" && r.reason instanceof SlotTakenError)).toHaveLength(1);
    const winner = race.find((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof holds.create>>> => r.status === "fulfilled")!.value;
    expect(winner.status).toBe("held");

    // While the hold lives, a booking by anyone else on that time is refused, but the holder confirms through it.
    const stranger = booking(sara.id, at(winner.startAt), 45, { customerId: "someone_else" });
    await prisma.customer.create({ data: { id: "someone_else", tenantId, waId: `web:other-${suffix}` } }).catch(() => undefined);
    await expect(orders.createBooking(stranger, blocking)).rejects.toBeInstanceOf(SlotTakenError);
    const order = await orders.createBooking(booking(sara.id, at(winner.startAt), 45, { customerId: winner.customerId, holdId: winner.id }), blocking);
    expect(order).toMatchObject({ status: "requested", resourceId: sara.id });
    expect((await holds.findById(tenantId, winner.id))?.status).toBe("confirmed");

    // The booking itself now blocks a new hold; an expired hold does not.
    await expect(holds.create(hold("third", winner.startAt, winner.endAt), blocking)).rejects.toBeInstanceOf(SlotTakenError);
    const stale = await holds.create({ ...hold(customerId, "2030-02-05T07:00:00Z", "2030-02-05T07:55:00Z"), expiresAt: new Date(Date.now() - 1000) }, blocking);
    expect(await holds.activeOverlapping(tenantId, sara.id, at("2030-02-05T00:00:00Z"), at("2030-02-06T00:00:00Z"), new Date())).toEqual([]);
    expect(await holds.expire(new Date())).toBeGreaterThanOrEqual(1);
    expect((await holds.findById(tenantId, stale.id))?.status).toBe("expired");
    // Holds are tenant scoped.
    expect(await holds.findById(otherTenantId, winner.id)).toBeNull();

    // Reschedule moves the booking under the same checks.
    const moved = await orders.reschedule(tenantId, order.id, { scheduledAt: at("2030-02-04T10:00:00Z"), resourceId: sara.id, durationMinutes: 45 }, blocking);
    expect(moved.scheduledAt).toBe("2030-02-04T10:00:00.000Z");
    await expect(orders.reschedule(tenantId, "nope", { scheduledAt: at("2030-02-04T12:00:00Z"), resourceId: sara.id, durationMinutes: 45 }, blocking)).rejects.toThrow();
  });
});

describe("Prisma commerce rows", () => {
  it("decrements stock conditionally and rolls the whole reservation back on a shortage", async () => {
    const catalog = new PrismaCatalogRepository(prisma);
    const shoe = await catalog.createOffering(tenantId, { name: { en: "Runner" }, type: "product", priceMinor: 45000, variants: [{ name: { en: "41" }, stock: 2, sortOrder: 1 }, { name: { en: "42" }, stock: 0, sortOrder: 2 }] });
    const bag = await catalog.createOffering(tenantId, { name: { en: "Coffee" }, type: "product", priceMinor: 5500, stock: 5 });
    const [v41, v42] = shoe.variants!;
    // Shortage on one line leaves the other untouched.
    const short = await catalog.reserveStock(tenantId, [{ offeringId: bag.id, quantity: 2 }, { offeringId: shoe.id, variantId: v42!.id, quantity: 1 }]);
    expect(short).toEqual({ ok: false, shortages: [{ offeringId: shoe.id, variantId: v42!.id, quantity: 1, available: 0 }] });
    expect((await catalog.getOffering(tenantId, bag.id))!.stock).toBe(5);
    // Concurrent reservations of the last two pairs: the sum never goes negative.
    const race = await Promise.all([catalog.reserveStock(tenantId, [{ offeringId: shoe.id, variantId: v41!.id, quantity: 2 }]), catalog.reserveStock(tenantId, [{ offeringId: shoe.id, variantId: v41!.id, quantity: 1 }])]);
    expect(race.filter((r) => r.ok)).toHaveLength(1);
    const left = (await catalog.getOffering(tenantId, shoe.id))!.variants!.find((v) => v.id === v41!.id)!.stock;
    expect([0, 1]).toContain(left);
    await catalog.releaseStock(tenantId, [{ offeringId: shoe.id, variantId: v41!.id, quantity: 2 - left! }]);
    expect((await catalog.getOffering(tenantId, shoe.id))!.variants!.find((v) => v.id === v41!.id)!.stock).toBe(2);
    // Untracked stock is never touched; another tenant cannot reserve this tenant's stock.
    const untracked = await catalog.createOffering(tenantId, { name: { en: "Gift card" }, type: "product", priceMinor: 10000 });
    expect(await catalog.reserveStock(tenantId, [{ offeringId: untracked.id, quantity: 99 }])).toEqual({ ok: true });
    expect(await catalog.reserveStock(otherTenantId, [{ offeringId: bag.id, quantity: 1 }])).toMatchObject({ ok: false });
  });

  it("carts, intents, receipts, sessions, memories and runs are tenant scoped", async () => {
    const carts = new PrismaCartRepository(prisma);
    const cart = await carts.create(tenantId, customerId, "AED", undefined);
    cart.items.push({ offeringId: "x", title: "X", quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100 });
    await carts.save(cart);
    expect((await carts.findOpen(tenantId, customerId))?.items).toHaveLength(1);
    expect(await carts.findOpen(otherTenantId, customerId)).toBeNull();

    const orders = new PrismaOrderRepository(prisma);
    const order = await orders.create({ tenantId, customerId, kind: "order", initialStatus: "pending_payment", fulfillmentType: "delivery", source: "web", items: [{ offeringId: `svc_ch_${suffix}`, title: "X", quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100, modifiers: [] }], currency: "AED", subtotalMinor: 100, deliveryFeeMinor: 0, vatMinor: 5, totalMinor: 100, paymentStatus: "pending", paymentMethod: "mock" });
    const intents = new PrismaPaymentIntentRepository(prisma);
    const intent = await intents.create({ id: `pi_${suffix}`, tenantId, orderId: order.id, provider: `it-${suffix}`, amountMinor: 100, currency: "AED", checkoutUrl: "https://x/pay", expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await intents.findByOrder(tenantId, order.id)).toMatchObject({ id: intent.id, status: "pending" });
    expect(await intents.findByOrder(otherTenantId, order.id)).toBeNull();
    expect((await intents.listExpired(new Date())).map((i) => i.id)).toContain(intent.id);
    const paid = await orders.updatePayment(tenantId, order.id, "paid", "paid", { type: "order.paid", payload: {} });
    expect(paid).toMatchObject({ status: "paid", paymentStatus: "paid" });
    await expect(orders.updatePayment(otherTenantId, order.id, "paid", "paid", { type: "order.paid", payload: {} })).rejects.toThrow();

    const receipts = new PrismaWebhookReceiptRepository(prisma);
    expect(await receipts.claim(`it-${suffix}`, "evt_1")).toBe(true);
    expect(await receipts.claim(`it-${suffix}`, "evt_1")).toBe(false);
    expect(await receipts.claim(`it-${suffix}`, "evt_2")).toBe(true);

    const sessions = new PrismaWebSessionRepository(prisma);
    const conversation = await prisma.conversation.create({ data: { tenantId, customerId, channelId: (await prisma.channel.create({ data: { tenantId, provider: "web", phoneNumberId: `web:${tenantId}`, wabaId: "web", displayPhone: "web chat", accessToken: "" } })).id, status: "bot" } });
    const ws = await sessions.create({ tenantId, customerId, conversationId: conversation.id, tokenHash: `hash_${suffix}` });
    expect(await sessions.findByTokenHash(`hash_${suffix}`)).toMatchObject({ id: ws.id, tenantId });
    expect(JSON.stringify(await sessions.findByTokenHash(`hash_${suffix}`))).not.toContain("tokenHash");
    expect(await sessions.findByTokenHash("nope")).toBeNull();

    const memories = new PrismaMemoryRepository(prisma);
    expect(await memories.getConsent(tenantId, customerId)).toBeNull();
    await memories.setConsent({ tenantId, customerId, memory: true, purpose: "personalization" });
    const m = await memories.upsert({ tenantId, customerId, kind: "preference", key: "preferred_staff", value: "Sara", confidence: 0.9, sourceMessageIds: ["wamid.1"], consentPurpose: "personalization" });
    await memories.upsert({ tenantId, customerId, kind: "preference", key: "preferred_staff", value: "Mona", confidence: 0.9, sourceMessageIds: ["wamid.2"], consentPurpose: "personalization" });
    const live = await memories.listActive(tenantId, customerId, new Date());
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: m.id, value: "Mona", sourceMessageIds: ["wamid.2"] });
    expect(await memories.listActive(otherTenantId, customerId, new Date())).toEqual([]);
    expect(await memories.forget(tenantId, customerId)).toBe(1);
    expect(await memories.listActive(tenantId, customerId, new Date())).toEqual([]);
    expect((await prisma.memory.findUnique({ where: { id: m.id } }))?.deletedAt).toBeTruthy();

    const runs = new PrismaAgentRunRepository(prisma);
    await runs.record({ tenantId, conversationId: conversation.id, channel: "web", model: "test", tools: [{ name: "x", input: {}, ok: true, ms: 1 }], memoryIds: [m.id], inputTokens: 1, outputTokens: 2, durationMs: 3, outcome: "replied" });
    expect(await runs.listForConversation(tenantId, conversation.id)).toMatchObject([{ channel: "web", tools: [{ name: "x" }] }]);
    expect(await runs.listForConversation(otherTenantId, conversation.id)).toEqual([]);
    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.conversation.delete({ where: { id: conversation.id } });
    await prisma.channel.deleteMany({ where: { tenantId } });
  });
});
