import { SlotTakenError, zonedToUtc } from "@ordr/domain";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaConversationRepository } from "../../src/adapters/prisma";
import { PrismaBookingHoldRepository } from "../../src/adapters/prisma-commerce";
import { PrismaMediaRepository, PrismaPropertyRepository, PrismaStayRepository } from "../../src/adapters/prisma-stays";
import type { CreateStayInput } from "../../src/ports";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let tenantId = "";
let otherTenantId = "";
let propertyId = "";
const roomId = `stay_it_${suffix}`;
const tz = "Asia/Dubai";
const blocking = ["requested", "confirmed", "checked_in"];
const nights = (checkIn: string, checkOut: string) => {
  const out: Date[] = [];
  for (let d = new Date(`${checkIn}T00:00:00Z`); d.toISOString().slice(0, 10) < checkOut; d.setUTCDate(d.getUTCDate() + 1)) out.push(zonedToUtc(d.toISOString().slice(0, 10), "15:00", tz));
  return out;
};
const range = (checkIn: string, checkOut: string) => ({ startAt: zonedToUtc(checkIn, "15:00", tz), endAt: zonedToUtc(checkOut, "12:00", tz), nightStarts: nights(checkIn, checkOut) });

function stay(customerId: string, checkIn: string, checkOut: string, extra: Partial<CreateStayInput> = {}): CreateStayInput {
  const r = range(checkIn, checkOut);
  return {
    tenantId,
    customerId,
    kind: "stay",
    initialStatus: "requested",
    fulfillmentType: "stay",
    source: "web",
    items: [{ offeringId: roomId, title: "Lodge", quantity: r.nightStarts.length, unitPriceMinor: 85000, lineTotalMinor: 85000 * r.nightStarts.length, modifiers: [] }],
    currency: "AED",
    subtotalMinor: 85000 * r.nightStarts.length,
    deliveryFeeMinor: 0,
    vatMinor: 0,
    totalMinor: 85000 * r.nightStarts.length,
    paymentStatus: "unpaid",
    paymentMethod: "at_property",
    scheduledAt: r.startAt,
    checkOutAt: r.endAt,
    propertyId,
    guests: 2,
    ...extra,
  };
}

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Resort IT", slug: `resort-it-${suffix}`, blueprintId: "resort" } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: "Other Resort IT", slug: `resort-other-${suffix}`, blueprintId: "resort" } })).id;
  for (const i of [1, 2, 3]) await prisma.customer.create({ data: { id: `cus_st_${suffix}_${i}`, tenantId, waId: `web:st${suffix}${i}`, name: `Guest ${i}` } });
  const properties = new PrismaPropertyRepository(prisma);
  propertyId = (await properties.create(tenantId, { name: { en: "Hatta Lodge IT" }, checkInTime: "15:00", checkOutTime: "12:00", amenities: ["Pool"], imageUrls: ["https://picsum.photos/seed/it/800/600"] })).id;
  await prisma.offering.create({ data: { id: roomId, tenantId, type: "stay", name: { en: "Lodge" }, priceMinor: 85000, propertyId, maxGuests: 2, units: 2 } });
});

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.bookingHold.deleteMany({ where: { tenantId: id } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId: id } });
    await prisma.order.deleteMany({ where: { tenantId: id } });
    await prisma.offering.deleteMany({ where: { tenantId: id } });
    await prisma.property.deleteMany({ where: { tenantId: id } });
    await prisma.mediaAsset.deleteMany({ where: { tenantId: id } });
    await prisma.message.deleteMany({ where: { tenantId: id } });
    await prisma.conversation.deleteMany({ where: { tenantId: id } });
    await prisma.channel.deleteMany({ where: { tenantId: id } });
    await prisma.customer.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("Prisma stays", () => {
  it("properties are tenant-scoped and round-trip their fields", async () => {
    const repo = new PrismaPropertyRepository(prisma);
    const p = await repo.get(tenantId, propertyId);
    expect(p).toMatchObject({ name: { en: "Hatta Lodge IT" }, checkInTime: "15:00", checkOutTime: "12:00", amenities: ["Pool"], imageUrls: ["https://picsum.photos/seed/it/800/600"], isActive: true });
    expect(await repo.get(otherTenantId, propertyId)).toBeNull();
    expect((await repo.update(tenantId, propertyId, { address: "Hatta Dam Road", amenities: ["Pool", "Spa"] }))?.amenities).toEqual(["Pool", "Spa"]);
  });

  it("never oversells a room type: per-night occupancy, holds, concurrent writes under the row lock", async () => {
    const stays = new PrismaStayRepository(prisma);
    const holds = new PrismaBookingHoldRepository(prisma);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const c = (i: number) => `cus_st_${suffix}_${i}`;

    // Two units. One stay 10-12, one hold 11-13 (other customer): night 11 is full.
    const a = range("2027-03-10", "2027-03-12");
    await stays.createStay(stay(c(1), "2027-03-10", "2027-03-12"), blocking, 2, a.nightStarts, now);
    const b = range("2027-03-11", "2027-03-13");
    const hold = await stays.createHold({ tenantId, customerId: c(2), offeringId: roomId, resourceId: roomId, startAt: b.startAt, endAt: b.endAt, expiresAt }, blocking, 2, b.nightStarts, now);
    expect(hold.resourceId).toBe(roomId);
    const occ = await stays.occupancy(tenantId, roomId, a.startAt, b.endAt, blocking, now);
    expect(occ.stays).toHaveLength(1);
    expect(occ.holds).toHaveLength(1);
    // A third party over night 11 is refused; the same nights for the holder (own hold ignored) still work.
    const d = range("2027-03-11", "2027-03-12");
    await expect(stays.createHold({ tenantId, customerId: c(3), offeringId: roomId, resourceId: roomId, startAt: d.startAt, endAt: d.endAt, expiresAt }, blocking, 2, d.nightStarts, now)).rejects.toBeInstanceOf(SlotTakenError);
    // Night 12 (after the stay ends, hold still on): one free unit.
    const e = range("2027-03-12", "2027-03-13");
    await stays.createStay(stay(c(3), "2027-03-12", "2027-03-13"), blocking, 2, e.nightStarts, now);
    await expect(stays.createStay(stay(c(1), "2027-03-12", "2027-03-13"), blocking, 2, e.nightStarts, now)).rejects.toBeInstanceOf(SlotTakenError);
    // The holder confirms through their hold; it becomes confirmed and the order carries the stay fields.
    const order = await stays.createStay(stay(c(2), "2027-03-11", "2027-03-13", { holdId: hold.id }), blocking, 2, b.nightStarts, now);
    expect(order).toMatchObject({ kind: "stay", propertyId, guests: 2, checkOutAt: b.endAt.toISOString(), scheduledAt: b.startAt.toISOString() });
    expect((await holds.findById(tenantId, hold.id))?.status).toBe("confirmed");

    // Concurrency: two customers race for the last unit on fresh nights; exactly one wins.
    const f = range("2027-04-01", "2027-04-03");
    await stays.createStay(stay(c(1), "2027-04-01", "2027-04-03"), blocking, 2, f.nightStarts, now);
    const results = await Promise.allSettled([stays.createStay(stay(c(2), "2027-04-01", "2027-04-03"), blocking, 2, f.nightStarts, now), stays.createStay(stay(c(3), "2027-04-02", "2027-04-04"), blocking, 2, range("2027-04-02", "2027-04-04").nightStarts, now)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof SlotTakenError)).toHaveLength(1);
    // Other tenant sees nothing.
    expect((await stays.occupancy(otherTenantId, roomId, a.startAt, f.endAt, blocking, now)).stays).toHaveLength(0);
  });

  it("stores and serves uploaded images; conversations stamp handoff and staff reply times", async () => {
    const media = new PrismaMediaRepository(prisma);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const saved = await media.save({ tenantId, mimeType: "image/png", data: bytes });
    const back = await media.get(saved.id);
    expect(back).toMatchObject({ mimeType: "image/png", sizeBytes: 8 });
    expect(back!.data.equals(bytes)).toBe(true);
    expect(await media.get("missing")).toBeNull();

    const conversations = new PrismaConversationRepository(prisma);
    const channel = await prisma.channel.create({ data: { tenantId, phoneNumberId: `it-${suffix}`, wabaId: "w", displayPhone: "+9710", accessToken: "t" } });
    const conv = await conversations.getOrCreateOpenConversation(tenantId, `cus_st_${suffix}_1`, channel.id);
    expect(conv.handedOverAt).toBeUndefined();
    await conversations.setConversationStatus(conv.id, "human");
    const first = (await conversations.findConversationById(conv.id))!;
    expect(first.handedOverAt).toBeInstanceOf(Date);
    await conversations.setConversationStatus(conv.id, "human");
    expect((await conversations.findConversationById(conv.id))!.handedOverAt?.getTime()).toBe(first.handedOverAt!.getTime());
    const at = new Date();
    await conversations.markStaffReply(conv.id, at);
    expect((await conversations.findConversationById(conv.id))!.lastStaffReplyAt?.getTime()).toBe(at.getTime());
    await conversations.recordMessage({ tenantId, conversationId: conv.id, direction: "in", kind: "text", payload: { kind: "text", text: "hi" }, createdAt: new Date() });
    const [msg] = await conversations.listMessages(conv.id);
    expect((await conversations.findMessageById(conv.id, msg!.id))?.id).toBe(msg!.id);
    expect(await conversations.findMessageById("other", msg!.id)).toBeNull();
    await conversations.touchInbound(conv.id, at);
    expect((await conversations.lastInboundAtByWaId(tenantId, [`web:st${suffix}1`, "nobody"])).get(`web:st${suffix}1`)?.getTime()).toBe(at.getTime());
    expect((await conversations.findCustomerByWaId(tenantId, `web:st${suffix}1`))?.name).toBe("Guest 1");
  });
});
