import { getBlueprint } from "@ordr/blueprints";
import { addItem, emptyCart, InvalidTransitionError } from "@ordr/domain";
import { describe, expect, it } from "vitest";
import { InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore } from "../adapters/memory-catalog";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { OrderError, OrderService } from "./order.service";

function setup(tenantSettings: Record<string, unknown> = {}) {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory" });
  const seed = seedTenantFromConfig(config);
  seed.tenant.settings = tenantSettings;
  const orders = new InMemoryOrderRepository();
  const bus = new InMemoryEventBus();
  const service = new OrderService(orders, new InMemoryTenantRepository([seed]), { get: getBlueprint }, bus, new InMemoryOutboxStore());
  const cart = addItem(emptyCart("AED"), { offeringId: "it_fries", title: "Fries", quantity: 2, unitPriceMinor: 1200, modifiers: [] });
  return { service, orders, bus, cart, tenantId: seed.tenant.id };
}

describe("OrderService", () => {
  it("quotes with blueprint defaults and tenant overrides", async () => {
    const base = setup();
    expect(await base.service.quote(base.tenantId, base.cart, "delivery")).toMatchObject({ deliveryFeeMinor: 1000, totalMinor: 3400 });
    const custom = setup({ deliveryFeeMinor: 500 });
    expect(await custom.service.quote(custom.tenantId, custom.cart, "delivery")).toMatchObject({ deliveryFeeMinor: 500, totalMinor: 2900 });
  });

  it("rejects fulfillment types the blueprint does not offer", async () => {
    const { service, cart, tenantId } = setup();
    await expect(service.quote(tenantId, cart, "teleport")).rejects.toThrow(OrderError);
  });

  it("requires a location for delivery and an item in the cart", async () => {
    const { service, cart, tenantId } = setup();
    await expect(service.place({ tenantId, customerId: "c1", cart, fulfillmentType: "delivery" })).rejects.toThrow(/location/);
    await expect(service.place({ tenantId, customerId: "c1", cart: emptyCart("AED"), fulfillmentType: "pickup" })).rejects.toThrow(/empty/);
  });

  it("places orders with sequential numbers and walks the state machine", async () => {
    const { service, bus, cart, tenantId } = setup();
    const first = await service.place({ tenantId, customerId: "c1", cart, fulfillmentType: "pickup" });
    const second = await service.place({ tenantId, customerId: "c2", cart, fulfillmentType: "pickup" });
    expect([first.number, second.number]).toEqual([1, 2]);
    expect(first.status).toBe("placed");

    const accepted = await service.transition(tenantId, first.id, "accept", "staff:1");
    expect(accepted.status).toBe("accepted");
    const preparing = await service.transition(tenantId, first.id, "start");
    expect(preparing.status).toBe("preparing");
    await expect(service.transition(tenantId, first.id, "deliver")).rejects.toThrow(InvalidTransitionError);

    expect(bus.published.map((e) => e.type)).toEqual(["order.placed", "order.placed", "order.status_changed", "order.status_changed"]);
    expect(bus.published[2]?.payload).toMatchObject({ from: "placed", to: "accepted", actor: "staff:1" });
  });

  it("hands the repository the same event it publishes, for the transactional outbox", async () => {
    const { service, orders, bus, cart, tenantId } = setup();
    const order = await service.place({ tenantId, customerId: "c1", cart, fulfillmentType: "pickup" });
    await service.transition(tenantId, order.id, "accept");
    expect(orders.outbox.map((e) => e.id)).toEqual(bus.published.map((e) => e.id));
    expect(orders.outbox[1]).toMatchObject({ type: "order.status_changed", subject: { kind: "order", id: order.id }, payload: { orderNumber: 1, to: "accepted" } });
  });
});
