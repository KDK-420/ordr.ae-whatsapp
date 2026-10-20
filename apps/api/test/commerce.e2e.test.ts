import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender } from "@ordr/whatsapp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import { AppModule } from "../src/app.module";
import { CommerceService } from "../src/commerce/commerce.service";
import { loadConfig } from "../src/config";
import { MaintenanceService } from "../src/maintenance.service";
import { MOCK_SIGNATURE_HEADER, MockPaymentProvider } from "../src/payments/payment-provider";
import { TOKENS } from "../src/tokens";

const SECRET = "payment-secret-0123456789";

describe("commerce: carts, stock, checkout and payment webhooks", () => {
  let app: INestApplication;
  let commerce: CommerceService;
  let catalog: InMemoryCatalogRepository;
  let orders: InMemoryOrderRepository;
  let bus: InMemoryEventBus;
  const provider = new MockPaymentProvider(SECRET, "https://shop.example");
  const tenantId = "tenant_seed";

  beforeEach(async () => {
    const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", WHATSAPP_SENDER: "log", SEED_BLUEPRINT_ID: "retail", SEED_TENANT_NAME: "Demo Shop", PAYMENT_WEBHOOK_SECRET: SECRET, PUBLIC_BASE_URL: "https://shop.example", CHECKOUT_MINUTES: "30" });
    orders = new InMemoryOrderRepository();
    bus = new InMemoryEventBus();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ config, overrides: { sender: new FakeSender(), orders, eventBus: bus, paymentProvider: provider } })] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.init();
    commerce = app.get(CommerceService);
    catalog = app.get(TOKENS.CatalogRepository);
  });
  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const stockOf = async (offeringId: string, variantId?: string) => {
    const o = (await catalog.getOffering(tenantId, offeringId))!;
    return variantId ? o.variants!.find((v) => v.id === variantId)!.stock : o.stock;
  };
  const webhook = (body: Buffer, signature: string) => http().post("/v1/webhooks/payments/mock").set("content-type", "application/json").set(MOCK_SIGNATURE_HEADER, signature).send(body.toString());

  it("prices from the catalog, reserves stock at checkout and pays only on a verified webhook, once", async () => {
    await commerce.addToCart(tenantId, "c1", { offeringId: "prd_ethiopia", variantId: "var_eth_1kg", quantity: 2 });
    await commerce.addToCart(tenantId, "c1", { offeringId: "prd_colombia", quantity: 1 });
    const cart = (await commerce.cart(tenantId, "c1"))!;
    expect(cart.items.map((l) => [l.title, l.variantTitle, l.quantity, l.lineTotalMinor])).toEqual([["Ethiopia Yirgacheffe", "1 kg", 2, 44000], ["Colombia Huila", undefined, 1, 5500]]);
    const quote = await commerce.quote(tenantId, cart);
    expect(quote).toMatchObject({ subtotalMinor: 49500, totalMinor: 49500, vatMinor: 2357, currency: "AED", repriced: false });

    // A price change in the catalog is picked up at checkout, not from the cart.
    await catalog.updateOffering(tenantId, "prd_colombia", { priceMinor: 6000 });
    const { order, intent, repriced } = await commerce.checkout(tenantId, "c1", { source: "web" });
    expect(repriced).toBe(true);
    expect(order).toMatchObject({ status: "pending_payment", paymentStatus: "pending", paymentMethod: "mock", totalMinor: 50000, source: "web", fulfillmentType: "delivery" });
    expect(intent).toMatchObject({ status: "pending", amountMinor: 50000, provider: "mock", checkoutUrl: `https://shop.example/pay/${intent.id}` });
    expect(await stockOf("prd_ethiopia", "var_eth_1kg")).toBe(1);
    expect(await stockOf("prd_colombia")).toBe(19);
    expect((await commerce.cart(tenantId, "c1"))).toBeNull();

    // The public checkout page data never includes customer details.
    const page = await http().get(`/v1/pay/${intent.id}`).expect(200);
    expect(page.body).toMatchObject({ status: "pending", amount: "AED 500.00", simulated: true, order: { number: order.number, items: [{ title: "Ethiopia Yirgacheffe", variantTitle: "1 kg", quantity: 2 }, { title: "Colombia Huila" }] } });
    expect(JSON.stringify(page.body)).not.toContain("c1");

    // A webhook with a bad signature is rejected and changes nothing.
    const { body } = provider.sign({ eventId: "evt_1", intentId: intent.id, status: "paid", amountMinor: 50000 });
    await webhook(body, "deadbeef").expect(400);
    expect((await orders.findById(tenantId, order.id))!.status).toBe("pending_payment");

    // A tampered body fails verification too.
    const { signature: goodSig } = provider.sign({ eventId: "evt_1", intentId: intent.id, status: "paid", amountMinor: 50000 });
    await webhook(Buffer.from(body.toString().replace("50000", "1")), goodSig).expect(400);

    // The genuine event pays the order exactly once; the replay is acknowledged but not applied.
    const first = await webhook(body, goodSig).expect(200);
    expect(first.body).toEqual({ ok: true, applied: true });
    const paid = (await orders.findById(tenantId, order.id))!;
    expect(paid).toMatchObject({ status: "paid", paymentStatus: "paid" });
    expect(orders.history.filter((h) => h.orderId === order.id).map((h) => h.type)).toContain("order.paid");
    expect(bus.published.map((e) => e.type)).toEqual(["order.checkout_created", "order.status_changed"]);
    const replay = await webhook(body, goodSig).expect(200);
    expect(replay.body).toEqual({ ok: true, applied: false });
    expect(orders.history.filter((h) => h.orderId === order.id && h.type === "order.paid")).toHaveLength(1);
    expect((await http().get(`/v1/pay/${intent.id}`)).body.status).toBe("paid");

    // An amount that does not match the intent is not applied.
    await commerce.addToCart(tenantId, "c2", { offeringId: "prd_colombia", quantity: 1 });
    const second = await commerce.checkout(tenantId, "c2", {});
    const wrong = provider.sign({ eventId: "evt_2", intentId: second.intent.id, status: "paid", amountMinor: 100 });
    expect((await webhook(wrong.body, wrong.signature).expect(200)).body).toEqual({ ok: true, applied: false });
    expect((await orders.findById(tenantId, second.order.id))!.status).toBe("pending_payment");
  });

  it("revalidates stock at checkout so two customers cannot buy the last unit, and a failed or expired payment releases it", async () => {
    await commerce.addToCart(tenantId, "a", { offeringId: "prd_runner", variantId: "var_run_41", quantity: 2 });
    await commerce.addToCart(tenantId, "b", { offeringId: "prd_runner", variantId: "var_run_41", quantity: 1 });
    const a = await commerce.checkout(tenantId, "a", {});
    expect(await stockOf("prd_runner", "var_run_41")).toBe(0);
    await expect(commerce.checkout(tenantId, "b", {})).rejects.toMatchObject({ code: "out_of_stock", details: { shortages: [{ offeringId: "prd_runner", variantId: "var_run_41", available: 0 }] } });
    // b's cart is still open to adjust.
    expect((await commerce.cart(tenantId, "b"))?.items).toHaveLength(1);
    // Adding beyond stock is refused up front; sold out items too.
    await expect(commerce.addToCart(tenantId, "b", { offeringId: "prd_decaf", quantity: 1 })).rejects.toMatchObject({ code: "out_of_stock" });
    await expect(commerce.addToCart(tenantId, "b", { offeringId: "prd_ethiopia", quantity: 1 })).rejects.toMatchObject({ code: "invalid" });

    // a's payment fails: the pair goes back on the shelf and the order is marked failed.
    const fail = provider.sign({ eventId: "evt_f", intentId: a.intent.id, status: "failed" });
    await webhook(fail.body, fail.signature).expect(200);
    expect((await orders.findById(tenantId, a.order.id))!).toMatchObject({ status: "failed", paymentStatus: "failed" });
    expect(await stockOf("prd_runner", "var_run_41")).toBe(2);

    // Now b can check out; the checkout then lapses and the maintenance tick releases the stock.
    const b = await commerce.checkout(tenantId, "b", {});
    expect(await stockOf("prd_runner", "var_run_41")).toBe(1);
    const maintenance = app.get(MaintenanceService);
    expect(await maintenance.tick(new Date(Date.now() + 29 * 60_000))).toEqual({ holds: 0, checkouts: 0 });
    expect(await maintenance.tick(new Date(Date.now() + 31 * 60_000))).toEqual({ holds: 0, checkouts: 1 });
    expect((await orders.findById(tenantId, b.order.id))!).toMatchObject({ status: "cancelled", paymentStatus: "failed" });
    expect(await stockOf("prd_runner", "var_run_41")).toBe(2);
    expect((await http().get(`/v1/pay/${b.intent.id}`)).body.status).toBe("expired");
    // A late webhook for the expired intent is ignored.
    const late = provider.sign({ eventId: "evt_late", intentId: b.intent.id, status: "paid", amountMinor: b.intent.amountMinor });
    expect((await webhook(late.body, late.signature).expect(200)).body).toEqual({ ok: true, applied: false });
  });

  it("the mock checkout page's pay button goes through the same webhook path", async () => {
    await commerce.addToCart(tenantId, "c", { offeringId: "prd_colombia", quantity: 3 });
    const { order, intent } = await commerce.checkout(tenantId, "c", {});
    const res = await http().post(`/v1/pay/${intent.id}/simulate`).send({}).expect(200);
    expect(res.body).toEqual({ ok: true, applied: true, status: "paid" });
    expect((await orders.findById(tenantId, order.id))!.status).toBe("paid");
    // Clicking again is harmless.
    expect((await http().post(`/v1/pay/${intent.id}/simulate`).send({}).expect(200)).body).toEqual({ ok: true, applied: false, status: "paid" });
    await http().post("/v1/pay/nope/simulate").send({}).expect(404);
    await http().post("/v1/webhooks/payments/stripe").send({}).expect(404);
  });

  it("carts are per tenant and per customer", async () => {
    await commerce.addToCart(tenantId, "c1", { offeringId: "prd_colombia", quantity: 1 });
    expect(await commerce.cart(tenantId, "c2")).toBeNull();
    expect(await commerce.cart("tenant_other", "c1")).toBeNull();
    await expect(commerce.addToCart("tenant_other", "c1", { offeringId: "prd_colombia", quantity: 1 })).rejects.toMatchObject({ code: "not_found" });
  });
});
