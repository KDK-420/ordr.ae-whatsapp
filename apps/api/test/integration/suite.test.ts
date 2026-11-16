import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaOrderRepository } from "../../src/adapters/prisma-catalog";
import { PrismaInventoryRepository, PrismaSuiteRepository } from "../../src/adapters/prisma-suite";
import type { CreateOrderInput } from "../../src/ports";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let tenantId = "";
let otherTenantId = "";
const customerId = `cus_su_${suffix}`;

function order(extra: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    tenantId,
    customerId,
    kind: "order",
    initialStatus: "placed",
    fulfillmentType: "pickup",
    source: "pos",
    items: [
      { offeringId: "", title: "Latte", quantity: 1, unitPriceMinor: 1800, lineTotalMinor: 1800, modifiers: [], stationId: "st_bar", kitchenStatus: "queued" },
      { offeringId: "", title: "Croissant", quantity: 1, unitPriceMinor: 1400, lineTotalMinor: 1400, modifiers: [], stationId: "st_bakery", kitchenStatus: "queued" },
    ],
    currency: "AED",
    subtotalMinor: 3200,
    deliveryFeeMinor: 0,
    vatMinor: 160,
    totalMinor: 3360,
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    ...extra,
  };
}

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Suite IT", slug: `suite-it-${suffix}`, blueprintId: "restaurant" } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: "Suite Other IT", slug: `suite-other-${suffix}`, blueprintId: "restaurant" } })).id;
  await prisma.customer.create({ data: { id: customerId, tenantId, waId: `pos:${suffix}`, name: "Walk-in" } });
});

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.stockMovement.deleteMany({ where: { tenantId: id } });
    await prisma.stockLevel.deleteMany({ where: { tenantId: id } });
    await prisma.recipeLine.deleteMany({ where: { tenantId: id } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId: id } });
    await prisma.supplier.deleteMany({ where: { tenantId: id } });
    await prisma.stockItem.deleteMany({ where: { tenantId: id } });
    await prisma.heldTicket.deleteMany({ where: { tenantId: id } });
    await prisma.orderPayment.deleteMany({ where: { tenantId: id } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId: id } });
    await prisma.order.deleteMany({ where: { tenantId: id } });
    await prisma.branch.deleteMany({ where: { tenantId: id } });
    await prisma.customer.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("Prisma restaurant suite", () => {
  it("branches keep their stations and are tenant-scoped", async () => {
    const repo = new PrismaSuiteRepository(prisma);
    const branch = await repo.createBranch(tenantId, { name: "Main Store", address: "Downtown", stations: [{ id: "st_bar", name: "Bar", categoryIds: ["cat_coffee"] }, { id: "st_bakery", name: "Bakery", categoryIds: [] }] });
    expect(branch).toMatchObject({ name: "Main Store", address: "Downtown", sortOrder: 0, isActive: true, stations: [{ id: "st_bar", name: "Bar", categoryIds: ["cat_coffee"] }, { id: "st_bakery", name: "Bakery", categoryIds: [] }] });
    expect(await repo.getBranch(otherTenantId, branch.id)).toBeNull();
    expect((await repo.updateBranch(tenantId, branch.id, { isActive: false }))?.isActive).toBe(false);
    expect(await repo.listBranches(tenantId)).toEqual([]);
    expect(await repo.listBranches(tenantId, { includeInactive: true })).toHaveLength(1);
    expect(await repo.updateBranch(otherTenantId, branch.id, { name: "Stolen" })).toBeNull();
  });

  it("orders carry the suite fields, lines move through the kitchen, client refs and tokens are unique", async () => {
    const orders = new PrismaOrderRepository(prisma);
    const suite = new PrismaSuiteRepository(prisma);
    const branch = await suite.createBranch(tenantId, { name: "Marina" });
    const firedAt = new Date();
    const created = await orders.create(order({ branchId: branch.id, tableLabel: "T4", contactName: "Noor", contactPhone: "971501234567", discountMinor: 100, discountReason: "Staff", clientRef: `ref-${suffix}`, publicToken: `tok-${suffix}-aaaaaaaaaaaa`, firedAt }));
    expect(created).toMatchObject({ branchId: branch.id, tableLabel: "T4", contactName: "Noor", contactPhone: "971501234567", discountMinor: 100, discountReason: "Staff", clientRef: `ref-${suffix}`, firedAt: firedAt.toISOString() });
    expect(created.items.map((i) => [i.title, i.stationId, i.kitchenStatus])).toEqual(expect.arrayContaining([["Latte", "st_bar", "queued"], ["Croissant", "st_bakery", "queued"]]));
    expect(created.items.every((i) => !!i.id)).toBe(true);

    expect((await orders.findByClientRef(tenantId, `ref-${suffix}`))?.id).toBe(created.id);
    expect(await orders.findByClientRef(otherTenantId, `ref-${suffix}`)).toBeNull();
    expect((await orders.findByPublicToken(`tok-${suffix}-aaaaaaaaaaaa`))?.id).toBe(created.id);
    // The database, not the application, is what stops a double order under a race.
    await expect(orders.create(order({ clientRef: `ref-${suffix}` }))).rejects.toThrow();

    const latte = created.items.find((i) => i.title === "Latte")!;
    const now = new Date();
    const patched = await orders.patch(tenantId, created.id, { readyAt: now, paymentStatus: "paid", paymentMethod: "card" }, [{ id: latte.id!, kitchenStatus: "ready", startedAt: now, readyAt: now }]);
    expect(patched).toMatchObject({ paymentStatus: "paid", paymentMethod: "card", readyAt: now.toISOString() });
    expect(patched.items.find((i) => i.id === latte.id)).toMatchObject({ kitchenStatus: "ready", readyAt: now.toISOString() });
    expect(patched.items.find((i) => i.title === "Croissant")).toMatchObject({ kitchenStatus: "queued" });
    await expect(orders.patch(otherTenantId, created.id, { paymentStatus: "paid" })).rejects.toThrow();

    expect((await orders.listRecent(tenantId, { branchId: branch.id, createdSince: new Date(Date.now() - 60_000) })).map((o) => o.id)).toEqual([created.id]);
    expect(await orders.listRecent(tenantId, { branchId: "nope" })).toEqual([]);

    const payment = await suite.addPayment({ tenantId, orderId: created.id, branchId: branch.id, method: "cash", amountMinor: 3360, tenderedMinor: 4000, changeMinor: 640, createdBy: "user:it" });
    expect(payment).toMatchObject({ method: "cash", amountMinor: 3360, changeMinor: 640 });
    expect(await suite.listPayments(tenantId, { orderId: created.id })).toHaveLength(1);
    expect(await suite.listPayments(otherTenantId, { orderId: created.id })).toEqual([]);

    const held = await suite.holdTicket({ tenantId, branchId: branch.id, label: "Table 2", payload: { lines: [{ offeringId: "x", quantity: 2 }] } });
    expect(await suite.listHeldTickets(tenantId, branch.id)).toEqual([expect.objectContaining({ id: held.id, label: "Table 2", payload: { lines: [{ offeringId: "x", quantity: 2 }] } })]);
    expect(await suite.releaseTicket(otherTenantId, held.id)).toBe(false);
    expect(await suite.releaseTicket(tenantId, held.id)).toBe(true);
  });

  it("the stock ledger and its cached levels stay in step, also under concurrent sales", async () => {
    const inv = new PrismaInventoryRepository(prisma);
    const suite = new PrismaSuiteRepository(prisma);
    const branch = await suite.createBranch(tenantId, { name: "Stock branch" });
    const beans = await inv.createItem(tenantId, { name: "Beans (1kg)", category: "Coffee", baseUnit: "g", unitLabel: "1kg bag", unitSize: 1000, reorderLevel: 10, costMinor: 9500 });
    const cups = await inv.createItem(tenantId, { name: "Cup 12oz", kind: "packaging", baseUnit: "each", unitLabel: "sleeve of 50", unitSize: 50 });
    expect(beans).toMatchObject({ kind: "ingredient", baseUnit: "g", unitSize: 1000, isActive: true });
    expect(await inv.getItem(otherTenantId, beans.id)).toBeNull();

    await inv.move([{ tenantId, branchId: branch.id, stockItemId: beans.id, type: "count", quantity: 24_000, note: "Opening" }, { tenantId, branchId: branch.id, stockItemId: cups.id, type: "count", quantity: 500 }]);
    // Twenty tills sell at once: every deduction must land.
    await Promise.all(Array.from({ length: 20 }, (_, i) => inv.move([{ tenantId, branchId: branch.id, stockItemId: beans.id, type: "sale", quantity: -18, refType: "order", refId: `o${i}` }, { tenantId, branchId: branch.id, stockItemId: cups.id, type: "sale", quantity: -1, refType: "order", refId: `o${i}` }])));
    const levels = await inv.levels(tenantId, branch.id);
    expect(levels.get(beans.id)).toBe(24_000 - 360);
    expect(levels.get(cups.id)).toBe(480);
    const ledger = await inv.listMovements(tenantId, { branchId: branch.id, stockItemId: beans.id, limit: 100 });
    expect(ledger.reduce((n, m) => n + m.quantity, 0)).toBe(24_000 - 360);
    expect(await inv.listMovements(tenantId, { refType: "order", refId: "o3", types: ["sale"] })).toHaveLength(2);
    expect((await inv.levels(otherTenantId, branch.id)).size).toBe(0);

    const lines = await inv.setRecipe(tenantId, "cof_latte", [{ stockItemId: beans.id, quantity: 18, appliesTo: "all" }, { stockItemId: cups.id, quantity: 1, modifierOptionId: "lat_size_regular", appliesTo: "takeaway" }]);
    expect(lines.map((l) => [l.quantity, l.modifierOptionId, l.appliesTo])).toEqual([[18, undefined, "all"], [1, "lat_size_regular", "takeaway"]]);
    expect(await inv.setRecipe(tenantId, "cof_latte", [{ stockItemId: beans.id, quantity: 20, appliesTo: "all" }])).toHaveLength(1);
    expect(await inv.recipes(tenantId, ["cof_latte"])).toHaveLength(1);
    expect(await inv.recipes(otherTenantId)).toEqual([]);

    const supplier = await inv.createSupplier(tenantId, { name: "Roastery", phone: "+971 4 000 2001", leadDays: 2 });
    const po1 = await inv.createPurchase({ tenantId, branchId: branch.id, supplierId: supplier.id, status: "ordered", lines: [{ stockItemId: beans.id, quantity: 10, unitCostMinor: 9800 }], totalMinor: 98_000, orderedAt: new Date().toISOString() });
    const po2 = await inv.createPurchase({ tenantId, branchId: branch.id, status: "draft", lines: [{ stockItemId: cups.id, quantity: 4, unitCostMinor: 2200 }], totalMinor: 8800 });
    expect([po1.number, po2.number]).toEqual([1, 2]);
    expect(po1.lines).toEqual([{ stockItemId: beans.id, quantity: 10, unitCostMinor: 9800 }]);
    const received = await inv.updatePurchase(tenantId, po1.id, { status: "received", receivedAt: new Date().toISOString() });
    expect(received).toMatchObject({ status: "received", supplierId: supplier.id });
    expect(await inv.getPurchase(otherTenantId, po1.id)).toBeNull();
    expect((await inv.listPurchases(tenantId, { branchId: branch.id })).map((p) => p.number)).toEqual([2, 1]);
    expect((await inv.updateItem(tenantId, beans.id, { costMinor: 9800 }))?.costMinor).toBe(9800);
  });
});
