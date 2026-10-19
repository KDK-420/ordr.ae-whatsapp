import { SlotTakenError } from "@ordr/domain";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaOutboxStore } from "../../src/adapters/outbox";
import { PrismaOrderRepository, PrismaResourceRepository } from "../../src/adapters/prisma-catalog";
import type { CreateBookingInput } from "../../src/ports";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let tenantId = "";
const customerId = `cus_it_${suffix}`;

const at = (iso: string) => new Date(iso);

function booking(resourceId: string, scheduledAt: Date, durationMinutes: number): CreateBookingInput {
  return {
    tenantId,
    customerId,
    kind: "booking",
    initialStatus: "requested",
    fulfillmentType: "in_store",
    source: "whatsapp",
    items: [{ offeringId: `svc_it_${suffix}`, title: "Haircut", quantity: 1, unitPriceMinor: 8000, lineTotalMinor: 8000, modifiers: [] }],
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
  };
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Bookings IT", slug: `bookings-it-${suffix}`, blueprintId: "salon" } });
  tenantId = tenant.id;
  await prisma.customer.create({ data: { id: customerId, tenantId, waId: `9715${suffix}`, name: "IT Customer" } });
  await prisma.offering.create({ data: { id: `svc_it_${suffix}`, tenantId, type: "service", name: { en: "Haircut" }, priceMinor: 8000, durationMinutes: 45 } });
});

afterAll(async () => {
  await prisma.outboxEvent.deleteMany({ where: { tenantId } });
  await prisma.order.deleteMany({ where: { tenantId } });
  await prisma.offering.deleteMany({ where: { tenantId } });
  await prisma.resource.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("Prisma resources and bookings", () => {
  it("stores resources with hours and skills and lists active ones in order", async () => {
    const repo = new PrismaResourceRepository(prisma);
    const sara = await repo.create(tenantId, { name: { en: "Sara", ar: "سارة" }, hours: { mon: [{ start: "10:00", end: "20:00" }] }, skills: [], sortOrder: 1 });
    const mona = await repo.create(tenantId, { name: { en: "Mona" }, type: "staff", hours: { tue: [{ start: "12:00", end: "21:00" }] }, skills: [`svc_it_${suffix}`], sortOrder: 2 });
    expect(sara).toMatchObject({ type: "staff", hours: { mon: [{ start: "10:00", end: "20:00" }] }, skills: [], isActive: true });
    expect((await repo.list(tenantId)).map((r) => r.id)).toEqual([sara.id, mona.id]);

    const updated = await repo.update(tenantId, mona.id, { isActive: false, hours: { wed: [{ start: "09:00", end: "13:00" }] } });
    expect(updated).toMatchObject({ isActive: false, hours: { wed: [{ start: "09:00", end: "13:00" }] }, skills: [`svc_it_${suffix}`] });
    expect((await repo.list(tenantId)).map((r) => r.id)).toEqual([sara.id]);
    expect((await repo.list(tenantId, { includeInactive: true })).map((r) => r.id)).toEqual([sara.id, mona.id]);
    expect(await repo.get(tenantId, "nope")).toBeNull();
    expect(await repo.update(tenantId, "nope", { isActive: true })).toBeNull();
  });

  it("creates bookings under a resource lock, refuses overlaps, lists by window and writes the outbox row", async () => {
    const resources = new PrismaResourceRepository(prisma);
    const orders = new PrismaOrderRepository(prisma);
    const sara = await resources.create(tenantId, { name: { en: "Sara 2" }, hours: {}, skills: [], sortOrder: 3 });
    const blocking = ["requested", "confirmed"];
    const outbox = (o: { id: string; number: number }) => ({ id: `evt_${o.id}`, tenantId, type: "order.placed", occurredAt: new Date().toISOString(), subject: { kind: "order", id: o.id }, payload: { orderNumber: o.number } });

    const first = await orders.createBooking(booking(sara.id, at("2030-01-07T07:00:00Z"), 45), blocking, outbox);
    expect(first).toMatchObject({ kind: "booking", status: "requested", resourceId: sara.id, scheduledAt: "2030-01-07T07:00:00.000Z", durationMinutes: 45 });
    expect(first.items[0]).toMatchObject({ title: "Haircut", quantity: 1 });
    expect(await prisma.outboxEvent.findUnique({ where: { id: `evt_${first.id}` } })).toMatchObject({ type: "order.placed", status: "pending" });

    // 07:30 overlaps 07:00-07:45; 07:45 does not.
    await expect(orders.createBooking(booking(sara.id, at("2030-01-07T07:30:00Z"), 30), blocking)).rejects.toBeInstanceOf(SlotTakenError);
    const second = await orders.createBooking(booking(sara.id, at("2030-01-07T07:45:00Z"), 30), blocking);
    expect(second.number).toBe(first.number + 1);

    // A cancelled booking no longer blocks its slot.
    await orders.updateStatus(tenantId, second.id, "cancelled", { type: "order.status_changed", payload: { from: "requested", to: "cancelled" } });
    const third = await orders.createBooking(booking(sara.id, at("2030-01-07T07:45:00Z"), 30), blocking);
    expect(third.status).toBe("requested");

    // Two concurrent attempts at the same slot: exactly one wins.
    const race = await Promise.allSettled([
      orders.createBooking(booking(sara.id, at("2030-01-07T10:00:00Z"), 60), blocking),
      orders.createBooking(booking(sara.id, at("2030-01-07T10:30:00Z"), 60), blocking),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((r) => r.status === "rejected" && r.reason instanceof SlotTakenError)).toHaveLength(1);

    const day = await orders.listBookings(tenantId, { from: at("2030-01-07T00:00:00Z"), to: at("2030-01-08T00:00:00Z") });
    expect(day.map((o) => o.scheduledAt)).toEqual(["2030-01-07T07:00:00.000Z", "2030-01-07T07:45:00.000Z", "2030-01-07T07:45:00.000Z", expect.stringMatching(/2030-01-07T10:(00|30)/)]);
    expect(await orders.listBookings(tenantId, { from: at("2030-01-07T00:00:00Z"), to: at("2030-01-08T00:00:00Z"), statuses: blocking })).toHaveLength(3);
    expect(await orders.listBookings(tenantId, { from: at("2030-01-08T00:00:00Z"), to: at("2030-01-09T00:00:00Z") })).toEqual([]);
  });

  it("schedules reminders in the outbox for a later time and claims them only when due", async () => {
    const store = new PrismaOutboxStore(prisma);
    const due = new Date("2030-01-06T07:00:00Z");
    const event = { id: `rem_${suffix}`, tenantId, type: "booking.reminder", occurredAt: new Date().toISOString(), subject: { kind: "order", id: "ord_x" }, payload: { leadMinutes: 1440 } };
    await store.schedule([event], due);
    await store.schedule([event], new Date(0)); // duplicate ids are ignored, the first schedule stands
    expect((await store.claim(50, new Date("2030-01-06T06:59:00Z"))).filter((r) => r.id === event.id)).toEqual([]);
    const claimed = await store.claim(50, due);
    expect(claimed.find((r) => r.id === event.id)).toMatchObject({ type: "booking.reminder", payload: { leadMinutes: 1440 }, attempts: 1 });
  });
});
