import { FlowRunner, MapActionRegistry } from "@ordr/flow-schema";
import type { InboundContent, OutboundMessage } from "@ordr/whatsapp";
import { describe, expect, it } from "vitest";
import { restaurant } from "./restaurant";

function body(m: OutboundMessage | undefined): string {
  if (!m) return "";
  if (m.type === "text") return m.text.body;
  if (m.type === "interactive" && "body" in m.interactive) return m.interactive.body.text;
  return m.type;
}

/** Stubs that mimic the API's action layer closely enough to exercise every flow path. */
function stubActions(opts: { withModifiers?: boolean } = {}) {
  let cartCount = 0;
  return new MapActionRegistry()
    .register("catalog.categories", async () => [{ id: "cat_burgers", title: "Burgers" }])
    .register("catalog.items", async () => [{ id: "it_classic", title: "Classic Burger", description: "AED 32.00" }])
    .register("cart.start_line", async () => ({
      offeringId: "it_classic",
      title: "Classic Burger",
      currency: "AED",
      unitPriceMinor: 3200,
      modifiers: [],
      groups: opts.withModifiers ? [{ id: "size", title: "Size", required: true, rows: [{ id: "large", title: "Large", priceDeltaMinor: 500 }] }] : [],
    }))
    .register("cart.next_modifier_group", async (_p, ctx) => (ctx.context.line as { groups: unknown[] }).groups[0] ?? null)
    .register("cart.select_modifier", async (_p, ctx) => ({ ...(ctx.context.line as object), groups: [] }))
    .register("cart.add", async (p) => {
      cartCount += Number(p.quantity);
      return { currency: "AED", items: [], subtotalMinor: 3200 * cartCount };
    })
    .register("cart.summary", async () => ({ count: cartCount, subtotal: `AED ${32 * cartCount}.00`, lines: "x", text: `Your cart: ${cartCount}` }))
    .register("cart.clear", async () => {
      cartCount = 0;
      return { currency: "AED", items: [], subtotalMinor: 0 };
    })
    .register("orders.quote", async (p) => ({ text: `Quote for ${String(p.fulfillmentType)}` }))
    .register("orders.create", async () => ({ number: 7, text: "Order #7 placed." }))
    .register("orders.latest", async () => null);
}

const actionCtx = { tenantId: "t1", customer: { id: "c1", waId: "971500000001", name: "Sara" } };
const context = { tenant: { name: "Demo Restaurant" }, customer: { name: "Sara" } };
const btn = (id: string): InboundContent => ({ kind: "button", id, title: id });
const row = (id: string): InboundContent => ({ kind: "list", id, title: id });
const txt = (text: string): InboundContent => ({ kind: "text", text });

describe("restaurant blueprint", () => {
  it("parses and exposes the expected flows", () => {
    expect(restaurant.flows.map((f) => f.id).sort()).toEqual(["checkout", "language", "main_menu", "order_food", "photos", "talk_to_us", "track_order", "view_cart"]);
    expect(restaurant.globalCommands.find((g) => g.flow === "view_cart")?.keywords).toContain("cart");
  });

  it("walks from greeting through item, quantity and pickup checkout", async () => {
    const runner = new FlowRunner(restaurant, stubActions());
    let r = await runner.start("main_menu", { language: "en", context }, actionCtx);
    expect(body(r.outbound[0])).toBe("Welcome to Demo Restaurant! How can we help you today?");
    r = await runner.resume(r.session!, btn("order_food"), actionCtx);
    expect(body(r.outbound[0])).toBe("What would you like to order?");
    r = await runner.resume(r.session!, row("cat_burgers"), actionCtx);
    expect(body(r.outbound[0])).toBe("Burgers: pick an item");
    r = await runner.resume(r.session!, row("it_classic"), actionCtx);
    expect(body(r.outbound[0])).toBe("How many Classic Burger? Reply with a number from 1 to 99.");
    r = await runner.resume(r.session!, txt("2"), actionCtx);
    expect(body(r.outbound[0])).toBe("Added. Your cart has 2 item(s), AED 64.00.");
    r = await runner.resume(r.session!, btn("checkout"), actionCtx);
    expect(r.session?.flowId).toBe("checkout");
    expect(body(r.outbound[0])).toBe("How would you like to get your order?");
    r = await runner.resume(r.session!, btn("pickup"), actionCtx);
    expect(body(r.outbound[0])).toBe("Quote for pickup");
    expect(body(r.outbound[1])).toBe("Shall we place this order?");
    r = await runner.resume(r.session!, btn("confirm"), actionCtx);
    expect(body(r.outbound[0])).toBe("Order #7 placed.");
    expect(r.completed).toBe(true);
  });

  it("asks for modifiers before quantity and for location on delivery", async () => {
    const runner = new FlowRunner(restaurant, stubActions({ withModifiers: true }));
    let r = await runner.start("order_food", { language: "en", context }, actionCtx);
    r = await runner.resume(r.session!, row("cat_burgers"), actionCtx);
    r = await runner.resume(r.session!, row("it_classic"), actionCtx);
    expect(body(r.outbound[0])).toBe("Classic Burger: Size");
    r = await runner.resume(r.session!, row("large"), actionCtx);
    expect(body(r.outbound[0])).toContain("How many");
    r = await runner.resume(r.session!, txt("1"), actionCtx);
    r = await runner.resume(r.session!, btn("checkout"), actionCtx);
    r = await runner.resume(r.session!, btn("delivery"), actionCtx);
    expect(r.outbound[0]).toMatchObject({ interactive: { type: "location_request_message" } });
    r = await runner.resume(r.session!, { kind: "location", latitude: 25.2, longitude: 55.3 }, actionCtx);
    expect(body(r.outbound[0])).toBe("Building, flat number and any landmarks?");
    r = await runner.resume(r.session!, txt("Marina Tower, flat 1203"), actionCtx);
    expect(body(r.outbound[0])).toBe("Quote for delivery");
  });

  it("rejects a bad quantity and re-asks", async () => {
    const runner = new FlowRunner(restaurant, stubActions());
    let r = await runner.start("order_food", { language: "en", context }, actionCtx);
    r = await runner.resume(r.session!, row("cat_burgers"), actionCtx);
    r = await runner.resume(r.session!, row("it_classic"), actionCtx);
    r = await runner.resume(r.session!, txt("200"), actionCtx);
    expect(body(r.outbound[0])).toBe("Please send a number between 1 and 99.");
    expect(r.session?.nodeId).toBe("ask_quantity");
  });

  it("shows an empty cart message and lets the customer clear a full one", async () => {
    const actions = stubActions();
    const runner = new FlowRunner(restaurant, actions);
    const empty = await runner.start("view_cart", { language: "en", context }, actionCtx);
    expect(body(empty.outbound[0])).toContain("Your cart is empty");
    let r = await runner.start("order_food", { language: "en", context }, actionCtx);
    r = await runner.resume(r.session!, row("cat_burgers"), actionCtx);
    r = await runner.resume(r.session!, row("it_classic"), actionCtx);
    r = await runner.resume(r.session!, txt("1"), actionCtx);
    const view = await runner.start("view_cart", { language: "en", context: { ...context, cart: r.session?.context.cart } }, actionCtx);
    expect(body(view.outbound[0])).toBe("Your cart: 1");
    const cleared = await runner.resume(view.session!, btn("clear"), actionCtx);
    expect(body(cleared.outbound[0])).toContain("Cart cleared");
  });

  it("renders Arabic copy and switches language through the language flow", async () => {
    const runner = new FlowRunner(restaurant, stubActions());
    const ar = await runner.start("main_menu", { language: "ar", context }, actionCtx);
    expect(body(ar.outbound[0])).toContain("أهلاً بك في Demo Restaurant");
    const s1 = await runner.start("language", { language: "en", context }, actionCtx);
    const s2 = await runner.resume(s1.session!, btn("ar"), actionCtx);
    expect(s2.session?.language).toBe("ar");
    expect(s2.session?.flowId).toBe("main_menu");
  });

  it("hands off to a human on 'agent'", async () => {
    const runner = new FlowRunner(restaurant, stubActions());
    expect(runner.matchGlobalCommand(txt("agent"))).toBe("talk_to_us");
    const r = await runner.start("talk_to_us", { language: "en", context }, actionCtx);
    expect(r.handoff).toBe(true);
  });
});
