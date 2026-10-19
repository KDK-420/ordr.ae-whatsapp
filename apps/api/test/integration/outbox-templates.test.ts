import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaOutboxStore } from "../../src/adapters/outbox";
import { PrismaTemplateRepository } from "../../src/adapters/templates";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const tenantId = `it_outbox_${suffix}`;

const event = (id: string, occurredAt: Date) => ({
  id,
  tenantId,
  type: "order.status_changed",
  subjectKind: "order",
  subjectId: `ord_${id}`,
  payload: { to: "accepted" },
  occurredAt,
});

beforeAll(async () => {
  await prisma.tenant.create({ data: { id: tenantId, name: "IT Outbox", slug: `it-outbox-${suffix}`, blueprintId: "restaurant" } });
});

afterAll(async () => {
  await prisma.outboxEvent.deleteMany({ where: { tenantId } });
  await prisma.messageTemplate.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("PrismaOutboxStore", () => {
  it("claims due events oldest first, exactly once, and tracks outcomes", async () => {
    const store = new PrismaOutboxStore(prisma);
    const t0 = new Date();
    await prisma.outboxEvent.createMany({
      // nextAttemptAt is set explicitly: the column default is the database clock, which may sit a few ms (or a timezone) after t0.
      data: [
        { ...event(`${suffix}_b`, new Date(t0.getTime() - 1000)), nextAttemptAt: new Date(t0.getTime() - 1000) },
        { ...event(`${suffix}_a`, new Date(t0.getTime() - 2000)), nextAttemptAt: new Date(t0.getTime() - 2000) },
        { ...event(`${suffix}_c`, t0), nextAttemptAt: new Date(t0.getTime() + 60_000) },
      ],
    });

    const first = await store.claim(10, t0);
    const ids = first.filter((r) => r.tenantId === tenantId).map((r) => r.id);
    expect(ids).toEqual([`${suffix}_a`, `${suffix}_b`]);
    expect(first.find((r) => r.id === `${suffix}_a`)).toMatchObject({ attempts: 1, type: "order.status_changed", subject: { kind: "order", id: `ord_${suffix}_a` }, payload: { to: "accepted" } });

    // Already claimed rows are not handed out again.
    expect((await store.claim(10, t0)).filter((r) => r.tenantId === tenantId)).toEqual([]);

    await store.markSent(`${suffix}_a`, t0);
    await store.markFailed(`${suffix}_b`, "boom", new Date(t0.getTime() + 5000));
    const rows = await prisma.outboxEvent.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
    expect(rows.map((r) => `${r.id.slice(-1)}:${r.status}`)).toEqual(["a:sent", "b:pending", "c:pending"]);
    expect(rows[1]!.lastError).toBe("boom");

    // b is due again after the backoff, c after its scheduled time.
    const later = await store.claim(10, new Date(t0.getTime() + 61_000));
    expect(later.filter((r) => r.tenantId === tenantId).map((r) => r.id.slice(-1))).toEqual(["b", "c"]);
    await store.markFailed(`${suffix}_b`, "gave up", null);
    expect((await prisma.outboxEvent.findUnique({ where: { id: `${suffix}_b` } }))!.status).toBe("failed");

    // A stale claim goes back to pending.
    expect(await store.requeueStale(new Date(t0.getTime() + 120_000))).toBeGreaterThanOrEqual(1);
    expect((await prisma.outboxEvent.findUnique({ where: { id: `${suffix}_c` } }))!.status).toBe("pending");
  });
});

describe("PrismaTemplateRepository", () => {
  it("upserts by tenant, name and language and finds approved templates", async () => {
    const repo = new PrismaTemplateRepository(prisma);
    const created = await repo.upsert({ tenantId, name: "ordr_order_status", language: "en", category: "UTILITY", purpose: "order_status", body: "Order {{1}}", parameters: ["orderNumber"] });
    expect(created.status).toBe("draft");
    await repo.setStatus(created.id, "pending", { metaId: "m1" });
    const again = await repo.upsert({ tenantId, name: "ordr_order_status", language: "en", category: "UTILITY", purpose: "order_status", body: "Order {{1}}!", parameters: ["orderNumber"] });
    expect(again).toMatchObject({ id: created.id, status: "pending", body: "Order {{1}}!", metaId: "m1" });
    expect(await repo.findApproved(tenantId, "order_status", "en")).toBeNull();
    await repo.setStatus(created.id, "approved");
    expect(await repo.findApproved(tenantId, "order_status", "en")).toMatchObject({ id: created.id, parameters: ["orderNumber"] });
    expect((await repo.list(tenantId)).map((t) => t.language)).toEqual(["en"]);
  });
});
