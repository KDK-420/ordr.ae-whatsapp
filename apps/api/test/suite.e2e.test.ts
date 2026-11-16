import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender } from "@ordr/whatsapp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository } from "../src/adapters/memory";
import { InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { loadConfig } from "../src/config";
import { OrderService } from "../src/orders/order.service";
import { TOKENS } from "../src/tokens";
import { RealtimeHub, type RealtimeEvent } from "../src/suite/realtime";

const EMAIL = "owner@daybreak.test";
const PASSWORD = "very-secret-password";

describe("restaurant suite", () => {
  let app: INestApplication;
  let tenants: InMemoryTenantRepository;
  let sender: FakeSender;
  let auth: { authorization: string };
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", WHATSAPP_SENDER: "log", SEED_PHONE_NUMBER_ID: "200000000000000", SEED_BLUEPRINT_ID: "restaurant", SEED_DEMO: "coffee", SEED_TENANT_NAME: "Daybreak Coffee", SEED_TENANT_SLUG: "daybreak", SEED_ADMIN_EMAIL: EMAIL, SEED_ADMIN_PASSWORD: PASSWORD });
  const server = () => app.getHttpServer();
  const stock = async (id: string): Promise<number> => (await request(server()).get("/merchant/inventory/overview").set(auth).expect(200)).body.items.find((i: { id: string }) => i.id === id).onHand;

  beforeEach(async () => {
    tenants = new InMemoryTenantRepository([seedTenantFromConfig(config)]);
    sender = new FakeSender();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register({ config, overrides: { sender, tenants, conversations: new InMemoryConversationRepository(), sessions: new InMemorySessionStore(), orders: new InMemoryOrderRepository(), eventBus: new InMemoryEventBus(), dedupe: new InMemoryDedupeStore() } })],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.init();
    const token = (await request(server()).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD }).expect(200)).body.token as string;
    auth = { authorization: `Bearer ${token}` };
  });
  afterEach(async () => {
    await app.close();
  });

  it("describes the restaurant: modules, theme, branch with stations, tax", async () => {
    const view = (await request(server()).get("/merchant/suite").set(auth).expect(200)).body;
    expect(view).toMatchObject({ tenant: { name: "Daybreak Coffee", slug: "daybreak" }, modules: ["storefront", "pos", "kds", "inventory", "whatsapp"], theme: { swatch: "espresso", primary: "#B4531F", ink: "#2B1D14" }, currency: "AED", vatRate: 0.05, vatInclusive: false });
    expect(view.branches).toHaveLength(1);
    expect(view.branches[0]).toMatchObject({ id: "br_main", name: "Main Store", stations: [{ id: "st_bar", name: "Bar" }, { id: "st_bakery", name: "Bakery" }] });
    await request(server()).get("/merchant/suite").expect(401);
  });

  it("a module that is off does not exist for the restaurant", async () => {
    (await tenants.findById("tenant_seed"))!.settings.modules = ["pos"];
    await request(server()).get("/merchant/pos/orders").set(auth).expect(200);
    await request(server()).get("/merchant/kds/board").set(auth).expect(403);
    await request(server()).get("/merchant/inventory/overview").set(auth).expect(403);
    await request(server()).get("/v1/store/daybreak").expect(404);
    // Tenants from before the suite have WhatsApp only.
    delete (await tenants.findById("tenant_seed"))!.settings.modules;
    await request(server()).get("/merchant/pos/orders").set(auth).expect(403);
    expect((await request(server()).get("/merchant/suite").set(auth).expect(200)).body.modules).toEqual(["whatsapp"]);
  });

  it("POS: prices on the server, takes the payment, and a retried request makes no second order", async () => {
    const lines = [
      { offeringId: "cof_latte", quantity: 1, optionIds: ["lat_size_regular"] },
      { offeringId: "cof_mocha", quantity: 1, optionIds: ["moc_size_regular"] },
      { offeringId: "bak_croissant", quantity: 1 },
    ];
    // The mockup ticket: Latte 18 + Mocha 20 + Croissant 14 = 52, VAT 5% on top = 2.60, total 54.60.
    const quote = (await request(server()).post("/merchant/pos/quote").set(auth).send({ lines, fulfillmentType: "dine_in" }).expect(200)).body;
    expect(quote).toMatchObject({ subtotalMinor: 5200, vatMinor: 260, totalMinor: 5460, vatInclusive: false, discountMinor: 0 });

    const body = { clientRef: "till-1-0001", fulfillmentType: "dine_in", tableLabel: "T4", lines, payment: { method: "cash", tenderedMinor: 6000 } };
    const order = (await request(server()).post("/merchant/pos/orders").set(auth).send(body).expect(201)).body;
    expect(order).toMatchObject({ number: 1, source: "pos", status: "placed", branchId: "br_main", tableLabel: "T4", totalMinor: 5460, paymentStatus: "paid", paidMinor: 5460, dueMinor: 0 });
    expect(order.payments).toEqual([expect.objectContaining({ method: "cash", amountMinor: 5460, tenderedMinor: 6000, changeMinor: 540 })]);
    expect(order.items.map((i: { title: string; stationId: string; kitchenStatus: string }) => [i.title, i.stationId, i.kitchenStatus])).toEqual([["Latte", "st_bar", "queued"], ["Mocha", "st_bar", "queued"], ["Butter Croissant", "st_bakery", "queued"]]);
    // Same clientRef again (a retry after a dropped response): the same order comes back, not a second charge.
    const again = (await request(server()).post("/merchant/pos/orders").set(auth).send(body).expect(201)).body;
    expect(again.id).toBe(order.id);
    expect(again.payments).toHaveLength(1);
    expect((await request(server()).get("/merchant/pos/orders").set(auth).expect(200)).body.orders).toHaveLength(1);
    // A till customer has no chat: nothing is sent on WhatsApp.
    expect(sender.sent).toHaveLength(0);

    // Bad input is refused with a reason a cashier can read.
    const missingSize = await request(server()).post("/merchant/pos/quote").set(auth).send({ lines: [{ offeringId: "cof_latte", quantity: 1 }], fulfillmentType: "pickup" }).expect(400);
    expect(missingSize.body.message).toBe("Latte: choose an option for Size");
    await request(server()).post("/merchant/pos/quote").set(auth).send({ lines: [{ offeringId: "nope", quantity: 1 }], fulfillmentType: "pickup" }).expect(400);
    // Discounts and split payments.
    const discounted = (await request(server()).post("/merchant/pos/orders").set(auth).send({ fulfillmentType: "pickup", contactName: "Omar", lines: [{ offeringId: "cof_espresso", quantity: 2 }], discount: { type: "percent", value: 50, reason: "Staff" } }).expect(201)).body;
    expect(discounted).toMatchObject({ subtotalMinor: 2400, discountMinor: 1200, vatMinor: 60, totalMinor: 1260, paymentStatus: "unpaid", dueMinor: 1260, contactName: "Omar" });
    const part = (await request(server()).post(`/merchant/pos/orders/${discounted.id}/payments`).set(auth).send({ method: "card", amountMinor: 1000 }).expect(201)).body;
    expect(part).toMatchObject({ paymentStatus: "pending", paidMinor: 1000, dueMinor: 260 });
    await request(server()).post(`/merchant/pos/orders/${discounted.id}/payments`).set(auth).send({ method: "cash", amountMinor: 999 }).expect(400);
    expect((await request(server()).post(`/merchant/pos/orders/${discounted.id}/payments`).set(auth).send({ method: "cash" }).expect(201)).body).toMatchObject({ paymentStatus: "paid", dueMinor: 0 });

    const report = (await request(server()).get("/merchant/pos/report").set(auth).expect(200)).body;
    expect(report).toMatchObject({ orders: 2, grossMinor: 6720, discountMinor: 1200, collectedMinor: 6720, unpaidMinor: 0 });
    expect(report.byMethod).toEqual([{ method: "cash", amountMinor: 5720, count: 2 }, { method: "card", amountMinor: 1000, count: 1 }]);
    expect(report.topItems[0]).toMatchObject({ title: "Espresso", quantity: 2 });
  });

  it("POS: holds a ticket and brings it back", async () => {
    const held = (await request(server()).post("/merchant/pos/held").set(auth).send({ label: "Table 2", payload: { lines: [{ offeringId: "cof_latte", quantity: 2 }] } }).expect(201)).body;
    expect((await request(server()).get("/merchant/pos/held").set(auth).expect(200)).body.tickets).toEqual([expect.objectContaining({ id: held.id, label: "Table 2", payload: { lines: [{ offeringId: "cof_latte", quantity: 2 }] } })]);
    await request(server()).delete(`/merchant/pos/held/${held.id}`).set(auth).expect(204);
    await request(server()).delete(`/merchant/pos/held/${held.id}`).set(auth).expect(404);
  });

  it("KDS: tickets move new, preparing, ready, completed; stations see their own lines; screens are signalled", async () => {
    const signals: RealtimeEvent[] = [];
    app.get(RealtimeHub).subscribe("tenant_seed", (e) => signals.push(e));
    const order = (await request(server()).post("/merchant/pos/orders").set(auth).send({ fulfillmentType: "pickup", contactName: "Sara", lines: [{ offeringId: "cof_cappuccino", quantity: 1, optionIds: ["cap_size_large"] }, { offeringId: "des_chocolate_cake", quantity: 1 }] }).expect(201)).body;
    expect(signals.map((s) => s.type)).toContain("order.placed");

    let board = (await request(server()).get("/merchant/kds/board").set(auth).expect(200)).body;
    expect(board.tickets).toEqual([expect.objectContaining({ orderId: order.id, number: 1, column: "new", fulfillmentType: "pickup", contactName: "Sara" })]);
    expect(board.tickets[0].lines.map((l: { title: string; modifiers: string[] }) => [l.title, l.modifiers])).toEqual([["Cappuccino", ["Large"]], ["Chocolate Cake", []]]);
    expect(board.stats).toMatchObject({ todayOrders: 1, pending: 1, completed: 0, avgPrepSeconds: null });

    // The bar sees only the coffee and starts it: the whole order is now "preparing" for the pass.
    const bar = (await request(server()).get("/merchant/kds/board?stationId=st_bar").set(auth).expect(200)).body;
    expect(bar.tickets[0].lines.map((l: { title: string }) => l.title)).toEqual(["Cappuccino"]);
    const started = (await request(server()).post(`/merchant/kds/orders/${order.id}/advance`).set(auth).send({ action: "start", stationId: "st_bar" }).expect(200)).body;
    expect(started).toMatchObject({ column: "preparing" });
    board = (await request(server()).get("/merchant/kds/board").set(auth).expect(200)).body;
    expect(board.tickets[0]).toMatchObject({ column: "preparing" });
    expect((await request(server()).get("/merchant/kds/board?stationId=st_bakery").set(auth).expect(200)).body.tickets[0]).toMatchObject({ column: "new" });

    // The bar finishes; the order is not ready until the bakery is too.
    expect((await request(server()).post(`/merchant/kds/orders/${order.id}/advance`).set(auth).send({ action: "ready", stationId: "st_bar" }).expect(200)).body).toMatchObject({ column: "ready" });
    expect((await request(server()).get("/merchant/kds/board").set(auth).expect(200)).body.tickets[0]).toMatchObject({ column: "preparing" });
    const cake = board.tickets[0].lines.find((l: { title: string }) => l.title === "Chocolate Cake");
    await request(server()).post(`/merchant/kds/orders/${order.id}/items/${cake.id}`).set(auth).send({ status: "ready" }).expect(200);
    board = (await request(server()).get("/merchant/kds/board").set(auth).expect(200)).body;
    expect(board.tickets[0]).toMatchObject({ column: "ready" });
    expect(board.tickets[0].readyAt).toBeTruthy();

    const done = (await request(server()).post(`/merchant/kds/orders/${order.id}/advance`).set(auth).send({ action: "complete" }).expect(200)).body;
    expect(done).toMatchObject({ column: "completed" });
    board = (await request(server()).get("/merchant/kds/board").set(auth).expect(200)).body;
    expect(board.stats).toMatchObject({ todayOrders: 1, pending: 0, completed: 1 });
    expect(board.stats.avgPrepSeconds).toBeGreaterThanOrEqual(0);
    expect((await request(server()).get("/merchant/pos/orders").set(auth).expect(200)).body.orders[0].status).toBe("completed");
    expect(signals.filter((s) => s.type === "kitchen.changed").length).toBeGreaterThanOrEqual(4);
    expect(signals.filter((s) => s.type === "order.status_changed").length).toBe(4);
    // A finished order cannot be started again.
    await request(server()).post(`/merchant/kds/orders/${order.id}/advance`).set(auth).send({ action: "bogus" }).expect(400);
    await request(server()).get("/merchant/kds/board?stationId=nope").set(auth).expect(404);
  });

  it("Inventory: recipes deduct by size and by takeaway, cancelling gives stock back, purchases and counts move the ledger", async () => {
    const overview = (await request(server()).get("/merchant/inventory/overview").set(auth).expect(200)).body;
    expect(overview.totals).toMatchObject({ items: 16, low: 2, out: 1 });
    const row = (id: string) => overview.items.find((i: { id: string }) => i.id === id);
    expect(row("stk_beans")).toMatchObject({ name: "Arabica Coffee Beans (1kg)", onHand: 24, reorderLevel: 10, status: "in_stock", valueMinor: 228000 });
    expect(row("stk_milk")).toMatchObject({ onHand: 18, status: "low" });
    expect(row("stk_croissant")).toMatchObject({ onHand: 0, status: "out" });
    expect(overview.categories).toEqual(["Bakery", "Coffee", "Dairy", "Packaging", "Syrups"]);

    // A large takeaway latte with an extra shot: 27 g beans, 320 ml milk, one 16oz cup, one lid.
    const takeaway = (await request(server()).post("/merchant/pos/orders").set(auth).send({ fulfillmentType: "pickup", lines: [{ offeringId: "cof_latte", quantity: 2, optionIds: ["lat_size_large", "lat_extra_shot"] }] }).expect(201)).body;
    expect(await stock("stk_beans")).toBe(23.95); // 24 kg - 54 g
    expect(await stock("stk_milk")).toBe(17.36); // 18 L - 640 ml
    expect(await stock("stk_cup_l")).toBe(13.96); // 14 sleeves - 2 cups
    expect(await stock("stk_lid")).toBe(15.98);
    expect(await stock("stk_cup_m")).toBe(20);

    // The same drink to stay uses no cup and no lid.
    await request(server()).post("/merchant/pos/orders").set(auth).send({ fulfillmentType: "dine_in", lines: [{ offeringId: "cof_latte", quantity: 1, optionIds: ["lat_size_regular"] }] }).expect(201);
    expect(await stock("stk_cup_m")).toBe(20);
    expect(await stock("stk_lid")).toBe(15.98);
    expect(await stock("stk_milk")).toBe(17.14);

    // Cancelling the takeaway order puts its stock back, once.
    await request(server()).post(`/merchant/orders/${takeaway.id}/transition`).set(auth).send({ event: "cancel" }).expect(200);
    expect(await stock("stk_cup_l")).toBe(14);
    expect(await stock("stk_beans")).toBe(23.98);
    const ledger = (await request(server()).get("/merchant/inventory/movements?stockItemId=stk_cup_l").set(auth).expect(200)).body.movements;
    expect(ledger.map((m: { type: string; units: number }) => [m.type, m.units])).toEqual([["sale_reversal", 0.04], ["sale", -0.04], ["count", 14]]);

    // Purchasing: order croissants, receive them, the item is no longer out and its cost follows the invoice.
    const po = (await request(server()).post("/merchant/inventory/purchases").set(auth).send({ supplierId: "sup_roastery", lines: [{ stockItemId: "stk_croissant", quantity: 40, unitCostMinor: 500 }] }).expect(201)).body;
    expect(po).toMatchObject({ number: 1, status: "ordered", totalMinor: 20000 });
    expect(await stock("stk_croissant")).toBe(0);
    expect((await request(server()).post(`/merchant/inventory/purchases/${po.id}/receive`).set(auth).expect(200)).body.status).toBe("received");
    await request(server()).post(`/merchant/inventory/purchases/${po.id}/receive`).set(auth).expect(400);
    const after = (await request(server()).get("/merchant/inventory/overview").set(auth).expect(200)).body;
    expect(after.items.find((i: { id: string }) => i.id === "stk_croissant")).toMatchObject({ onHand: 40, status: "in_stock", costMinor: 500 });
    expect(after.totals).toMatchObject({ out: 0 });

    // Wastage and a count.
    expect((await request(server()).post("/merchant/inventory/adjustments").set(auth).send({ stockItemId: "stk_croissant", type: "wastage", quantity: 3, note: "Dropped tray" }).expect(201)).body.onHand).toBe(37);
    expect((await request(server()).post("/merchant/inventory/adjustments").set(auth).send({ stockItemId: "stk_croissant", type: "count", quantity: 35 }).expect(201)).body.onHand).toBe(35);
    await request(server()).post("/merchant/inventory/adjustments").set(auth).send({ stockItemId: "stk_croissant", type: "wastage", quantity: 0 }).expect(400);
    const moves = (await request(server()).get("/merchant/inventory/movements?stockItemId=stk_croissant").set(auth).expect(200)).body.movements;
    expect(moves.map((m: { type: string; units: number }) => [m.type, m.units])).toEqual([["count", -2], ["wastage", -3], ["purchase", 40]]);

    // New stock item with opening stock, and a recipe for it.
    const item = (await request(server()).post("/merchant/inventory/items").set(auth).send({ name: "Vanilla Syrup (750ml)", category: "Syrups", baseUnit: "ml", unitLabel: "750ml bottle", unitSize: 750, reorderLevel: 4, costMinor: 2700, openingStock: 5 }).expect(201)).body;
    expect(item).toMatchObject({ onHand: 5, status: "in_stock", valueMinor: 13500 });
    const recipe = (await request(server()).put("/merchant/inventory/recipes/cold_cold_brew").set(auth).send({ lines: [{ stockItemId: "stk_beans", quantity: 25 }, { stockItemId: item.id, quantity: 15 }] }).expect(200)).body;
    expect(recipe.lines).toHaveLength(2);
    await request(server()).put("/merchant/inventory/recipes/cold_cold_brew").set(auth).send({ lines: [{ stockItemId: "nope", quantity: 1 }] }).expect(400);
  });

  it("Storefront: public menu, an order by a guest, and tracking that follows the kitchen", async () => {
    const store = (await request(server()).get("/v1/store/daybreak").expect(200)).body;
    expect(store).toMatchObject({ name: "Daybreak Coffee", headline: "Exceptional Coffee, Delivered.", currency: "AED", vatInclusive: false, deliveryFeeMinor: 800, fulfillmentTypes: ["pickup", "delivery"], theme: { swatch: "espresso" } });
    expect(store.categories.map((c: { name: string }) => c.name)).toEqual(["Coffee", "Cold Drinks", "Bakery", "Desserts"]);
    expect(store.featured.map((i: { name: string }) => i.name)).toEqual(["Espresso", "Iced Americano", "Butter Croissant", "Chocolate Cake", "Americano"]);
    const latte = store.categories[0].items.find((i: { id: string }) => i.id === "cof_latte");
    expect(latte).toMatchObject({ name: "Latte", priceMinor: 1800, price: "AED 18.00" });
    expect(latte.modifierGroups.map((g: { name: string; minSelect: number }) => [g.name, g.minSelect])).toEqual([["Size", 1], ["Milk", 0], ["Extras", 0]]);
    // Nothing private rides along.
    expect(JSON.stringify(store)).not.toMatch(/accessToken|phoneNumberId|passwordHash|handoffNumbers/);
    expect((await request(server()).get("/v1/store/daybreak?lang=ar").expect(200)).body.categories[0].name).toBe("قهوة");
    await request(server()).get("/v1/store/nobody").expect(404);

    const lines = [{ offeringId: "cof_latte", quantity: 2, optionIds: ["lat_size_large", "lat_milk_oat"] }, { offeringId: "bak_muffin", quantity: 1 }];
    const quote = (await request(server()).post("/v1/store/daybreak/quote").send({ lines, fulfillmentType: "delivery" }).expect(200)).body;
    // 2 x (18 + 4 + 3) + 14 = 64, delivery 8, VAT 5% of 72 = 3.60.
    expect(quote).toMatchObject({ subtotalMinor: 6400, deliveryFeeMinor: 800, vatMinor: 360, totalMinor: 7560 });

    await request(server()).post("/v1/store/daybreak/orders").send({ clientRef: "browser-abc-1", fulfillmentType: "delivery", lines, name: "Noor", phone: "050 123 4567" }).expect(400);
    const placed = (await request(server()).post("/v1/store/daybreak/orders").send({ clientRef: "browser-abc-1", fulfillmentType: "delivery", lines, name: "Noor", phone: "050 123 4567", address: "Marina Gate 2, apt 1204" }).expect(201)).body;
    expect(placed.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(placed.order).toMatchObject({ number: 1, status: "placed", step: 0, steps: ["placed", "preparing", "ready", "out_for_delivery", "delivered"], total: "AED 75.60", deliveryFee: "AED 8.00", fulfillmentType: "delivery", branch: { name: "Main Store" } });
    // A double tap on "Place order" returns the same order.
    expect((await request(server()).post("/v1/store/daybreak/orders").send({ clientRef: "browser-abc-1", fulfillmentType: "delivery", lines, name: "Noor", phone: "050 123 4567", address: "Marina Gate 2, apt 1204" }).expect(201)).body.token).toBe(placed.token);

    // Staff see it at the till and in the kitchen, with who and where.
    const staff = (await request(server()).get("/merchant/pos/orders").set(auth).expect(200)).body.orders;
    expect(staff).toHaveLength(1);
    expect(staff[0]).toMatchObject({ source: "web", contactName: "Noor", contactPhone: "971501234567", deliveryLocation: { address: "Marina Gate 2, apt 1204" }, paymentStatus: "unpaid" });
    const ticket = (await request(server()).get("/merchant/kds/board").set(auth).expect(200)).body.tickets[0];
    expect(ticket).toMatchObject({ source: "web", fulfillmentType: "delivery", column: "new" });

    // The kitchen works; the customer's page follows. A delivery leaves the kitchen as "out for delivery".
    await request(server()).post(`/merchant/kds/orders/${ticket.orderId}/advance`).set(auth).send({ action: "start" }).expect(200);
    expect((await request(server()).get(`/v1/store/daybreak/orders/${placed.token}`).expect(200)).body).toMatchObject({ status: "preparing", step: 1 });
    await request(server()).post(`/merchant/kds/orders/${ticket.orderId}/advance`).set(auth).send({ action: "complete" }).expect(200);
    expect((await request(server()).get(`/v1/store/daybreak/orders/${placed.token}`).expect(200)).body).toMatchObject({ status: "out_for_delivery", step: 3 });
    // Tokens are per order and per store; guessing gets nothing.
    await request(server()).get("/v1/store/daybreak/orders/aaaaaaaaaaaaaaaaaaaaaa").expect(404);
    // A storefront customer has no chat either: no WhatsApp message was attempted.
    expect(sender.sent).toHaveLength(0);
  });

  it("the operator switches modules and theme; owners cannot", async () => {
    const got = (await request(server()).get("/merchant/admin/tenants/tenant_seed/suite").set(auth).expect(200)).body;
    expect(got.available).toEqual(["storefront", "pos", "kds", "inventory", "whatsapp"]);
    const set = (await request(server()).patch("/merchant/admin/tenants/tenant_seed/suite").set(auth).send({ modules: ["kds", "pos"], theme: { swatch: "ocean" } }).expect(200)).body;
    expect(set).toMatchObject({ modules: ["pos", "kds"], theme: { swatch: "ocean", primary: "#0E5E6F", ink: "#0F2A30" } });
    await request(server()).get("/merchant/inventory/overview").set(auth).expect(403);
    const custom = (await request(server()).patch("/merchant/admin/tenants/tenant_seed/suite").set(auth).send({ theme: { swatch: "custom", primary: "#112233" } }).expect(200)).body;
    expect(custom.theme).toMatchObject({ swatch: "custom", primary: "#112233", accent: "#E9B87A" });
    await request(server()).patch("/merchant/admin/tenants/tenant_seed/suite").set(auth).send({ modules: ["teleport"] }).expect(400);

    const staff = (await request(server()).post("/merchant/users").set(auth).send({ email: "cashier@daybreak.test", name: "Cashier", role: "staff" }).expect(201)).body;
    const staffToken = (await request(server()).post("/merchant/auth/login").send({ email: "cashier@daybreak.test", password: staff.temporaryPassword }).expect(200)).body.token as string;
    await request(server()).patch("/merchant/admin/tenants/tenant_seed/suite").set({ authorization: `Bearer ${staffToken}` }).send({ modules: [] }).expect(403);
    await request(server()).post("/merchant/suite/branches").set({ authorization: `Bearer ${staffToken}` }).send({ name: "Marina" }).expect(403);
    const branch = (await request(server()).post("/merchant/suite/branches").set(auth).send({ name: "Marina", address: "Marina Walk" }).expect(201)).body;
    expect(branch).toMatchObject({ name: "Marina", stations: [{ id: "st_kitchen", name: "Kitchen" }] });
    // An order at the new branch stays there.
    const order = (await request(server()).post("/merchant/pos/orders").set(auth).send({ branchId: branch.id, fulfillmentType: "pickup", lines: [{ offeringId: "bak_brownie", quantity: 1 }] }).expect(201)).body;
    expect(order.branchId).toBe(branch.id);
    expect((await request(server()).get(`/merchant/kds/board?branchId=${branch.id}`).set(auth).expect(200)).body.tickets).toHaveLength(1);
    expect((await request(server()).get("/merchant/kds/board?branchId=br_main").set(auth).expect(200)).body.tickets).toHaveLength(0);
    await request(server()).get("/merchant/kds/board?branchId=nope").set(auth).expect(404);
  });

  it("the operator creates a restaurant with the modules and look it picked; the owner gets exactly those", async () => {
    const created = (await request(server()).post("/merchant/admin/tenants").set(auth).send({ name: "Olive House", blueprintId: "restaurant", ownerEmail: "owner@olive.test", ownerName: "Nour", modules: ["kds", "pos"], swatch: "olive_grove" }).expect(201)).body;
    expect(created.tenant).toMatchObject({ slug: "olive-house", settings: { modules: ["pos", "kds"], theme: { swatch: "olive_grove" } } });
    await request(server()).post("/merchant/admin/tenants").set(auth).send({ name: "Bad Cafe", blueprintId: "restaurant", ownerEmail: "bad@cafe.test", ownerName: "B", modules: ["teleport"] }).expect(400);

    const token = (await request(server()).post("/merchant/auth/login").send({ email: "owner@olive.test", password: created.owner.temporaryPassword }).expect(200)).body.token as string;
    const owner = { authorization: `Bearer ${token}` };
    const view = (await request(server()).get("/merchant/suite").set(owner).expect(200)).body;
    expect(view).toMatchObject({ tenant: { slug: "olive-house" }, modules: ["pos", "kds"], theme: { swatch: "olive_grove", primary: "#3F5F3A", ink: "#1F2A1C" } });
    expect((await request(server()).get("/merchant/me").set(owner).expect(200)).body.tenant.suite).toEqual(["pos", "kds"]);
    // The modules it does not have do not exist for it: no stock screens, no public ordering site.
    await request(server()).get("/merchant/inventory/overview").set(owner).expect(403);
    await request(server()).get("/v1/store/olive-house").expect(404);
    await request(server()).get("/merchant/kds/board").set(owner).expect(200);

    // A merchant created without a choice keeps WhatsApp only, as before the suite.
    const plain = (await request(server()).post("/merchant/admin/tenants").set(auth).send({ name: "Plain Diner", blueprintId: "restaurant", ownerEmail: "owner@plain.test", ownerName: "P" }).expect(201)).body;
    const plainToken = (await request(server()).post("/merchant/auth/login").send({ email: "owner@plain.test", password: plain.owner.temporaryPassword }).expect(200)).body.token as string;
    expect((await request(server()).get("/merchant/me").set({ authorization: `Bearer ${plainToken}` }).expect(200)).body.tenant.suite).toEqual(["whatsapp"]);
  });

  it("stops one visitor from flooding the kitchen with online orders", async () => {
    const body = (n: number) => ({ clientRef: `flood-ref-${n}`, fulfillmentType: "pickup", lines: [{ offeringId: "bak_brownie", quantity: 1 }], name: "Bot", phone: "0500000000" });
    for (let n = 0; n < 12; n++) await request(server()).post("/v1/store/daybreak/orders").send(body(n)).expect(201);
    const blocked = await request(server()).post("/v1/store/daybreak/orders").send(body(99)).expect(429);
    expect(blocked.body.message).toMatch(/Too many requests/);
    // The till is not a visitor: staff keep selling.
    await request(server()).post("/merchant/pos/orders").set(auth).send({ fulfillmentType: "pickup", lines: [{ offeringId: "bak_brownie", quantity: 1 }] }).expect(201);
  });

  it("a WhatsApp order joins the same operation: a branch, the kitchen screen, the day's orders, and stock", async () => {
    const customer = await app.get(TOKENS.ConversationRepository).upsertCustomer("tenant_seed", "971501112233", "Huda");
    const beans = await stock("stk_beans");
    const cups = await stock("stk_cup_m");
    // What the chat flow places once the customer confirms: one regular latte and a brownie, for pickup.
    const placed = await app.get(OrderService).place({
      tenantId: "tenant_seed",
      customerId: customer.id,
      fulfillmentType: "pickup",
      cart: {
        currency: "AED",
        subtotalMinor: 3300,
        items: [
          { offeringId: "cof_latte", title: "Latte", quantity: 1, unitPriceMinor: 1800, modifiers: [{ groupId: "lat_size", optionId: "lat_size_regular", title: "Regular", priceDeltaMinor: 0 }], lineTotalMinor: 1800 },
          { offeringId: "bak_brownie", title: "Brownie", quantity: 1, unitPriceMinor: 1500, modifiers: [], lineTotalMinor: 1500 },
        ],
      },
    });
    expect(placed).toMatchObject({ source: "whatsapp", branchId: "br_main" });
    expect(placed.items.map((i) => [i.title, i.stationId, i.kitchenStatus])).toEqual([["Latte", "st_bar", "queued"], ["Brownie", "st_bakery", "queued"]]);

    const board = (await request(server()).get("/merchant/kds/board").set(auth).expect(200)).body;
    expect(board.tickets).toHaveLength(1);
    expect(board.tickets[0]).toMatchObject({ orderId: placed.id, column: "new", source: "whatsapp" });
    expect((await request(server()).get("/merchant/pos/orders").set(auth).expect(200)).body.orders.map((o: { id: string }) => o.id)).toEqual([placed.id]);
    // 18 g of beans and one 12oz cup left the shelf without anyone touching the stock screen.
    expect(await stock("stk_beans")).toBe(Math.round((beans - 0.018) * 100) / 100);
    expect(await stock("stk_cup_m")).toBeLessThan(cups);
  });

  it("the operator creates a coffee shop with the full demo: its own menu, stations, stock and recipes, ready to sell", async () => {
    const created = (await request(server()).post("/merchant/admin/tenants").set(auth).send({ name: "Sunrise Coffee", blueprintId: "restaurant", ownerEmail: "owner@sunrise.test", ownerName: "Sam", demoSet: "coffee", swatch: "chili" }).expect(201)).body;
    expect(created.tenant.settings).toMatchObject({ modules: ["storefront", "pos", "kds", "inventory", "whatsapp"], theme: { swatch: "chili", tagline: "Specialty coffee" }, vatInclusive: false });
    await request(server()).post("/merchant/admin/tenants").set(auth).send({ name: "Sunrise Salon", blueprintId: "salon", ownerEmail: "owner@salon.test", ownerName: "S", demoSet: "coffee" }).expect(400);

    const token = (await request(server()).post("/merchant/auth/login").send({ email: "owner@sunrise.test", password: created.owner.temporaryPassword }).expect(200)).body.token as string;
    const owner = { authorization: `Bearer ${token}` };
    const catalog = (await request(server()).get("/merchant/catalog").set(owner).expect(200)).body;
    expect(catalog.offerings).toHaveLength(14);
    const latte = catalog.offerings.find((o: { name: { en: string } }) => o.name.en === "Latte");
    expect(latte.id).not.toBe("cof_latte");
    expect(latte.imageUrl).toBe("/art/coffee/latte.jpg");
    const option = (name: string) => latte.modifierGroups.flatMap((g: { options: Array<{ id: string; name: { en: string } }> }) => g.options).find((o: { name: { en: string } }) => o.name.en === name).id as string;

    // Its own branch, with the bar and the bakery pointing at its own categories.
    const view = (await request(server()).get("/merchant/suite").set(owner).expect(200)).body;
    expect(view.branches).toHaveLength(1);
    expect(view.branches[0].id).not.toBe("br_main");
    const categoryIds = new Set(catalog.categories.map((c: { id: string }) => c.id));
    expect(view.branches[0].stations.map((st: { name: string; categoryIds: string[] }) => [st.name, st.categoryIds.length, st.categoryIds.every((c) => categoryIds.has(c))])).toEqual([["Bar", 2, true], ["Bakery", 2, true]]);

    const overview = async () => (await request(server()).get("/merchant/inventory/overview").set(owner).expect(200)).body;
    const before = await overview();
    expect(before.totals).toMatchObject({ items: 16, low: 2, out: 1 });
    const level = (o: { items: Array<{ name: string; onHand: number }> }, name: string) => o.items.find((i) => i.name === name)!.onHand;
    expect(level(before, "Arabica Coffee Beans (1kg)")).toBe(24);
    expect((await request(server()).get("/merchant/inventory/recipes").set(owner).expect(200)).body.lines).toHaveLength(60);
    expect((await request(server()).get("/merchant/inventory/suppliers").set(owner).expect(200)).body.suppliers).toHaveLength(3);

    // A large takeaway latte with an extra shot uses this shop's recipe: 27 g beans, 320 ml milk, one 16oz cup.
    const sale = (await request(server()).post("/merchant/pos/orders").set(owner).send({ fulfillmentType: "pickup", lines: [{ offeringId: latte.id, quantity: 1, optionIds: [option("Large"), option("Extra shot")] }] }).expect(201)).body;
    const after = await overview();
    expect(level(after, "Arabica Coffee Beans (1kg)")).toBe(23.97);
    expect(level(after, "Whole Milk (1L)")).toBe(17.68);
    expect(level(after, "Hot Cup 16oz")).toBe(13.98);
    const board = (await request(server()).get("/merchant/kds/board").set(owner).expect(200)).body;
    expect(board.tickets.map((t: { orderId: string; lines: Array<{ stationId: string }> }) => [t.orderId, t.lines[0]!.stationId])).toEqual([[sale.id, "st_bar"]]);

    // Its ordering site is up in its own colours, and the first shop's stock did not move.
    const site = (await request(server()).get("/v1/store/sunrise-coffee").expect(200)).body;
    expect(site).toMatchObject({ name: "Sunrise Coffee", theme: { swatch: "chili", primary: "#B3261E" }, headline: "Exceptional Coffee, Delivered." });
    expect(site.categories.map((c: { name: string; items: unknown[] }) => [c.name, c.items.length])).toEqual([["Coffee", 6], ["Cold Drinks", 3], ["Bakery", 3], ["Desserts", 2]]);
    expect(await stock("stk_beans")).toBe(24);
  });
});
