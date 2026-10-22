import { fixtures, type OutboundMessage, parseWebhook } from "@ordr/whatsapp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers";

function bodyOf(m: OutboundMessage | undefined): string {
  if (!m) return "";
  if (m.type === "text") return m.text.body;
  if (m.type === "interactive" && "body" in m.interactive) return m.interactive.body.text;
  return m.type;
}

describe("ConversationService", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.app.close();
  });

  async function send(payload: ReturnType<typeof fixtures.textMessageWebhook>) {
    for (const ev of parseWebhook(payload)) await h.service.handleEvent(ev);
  }

  it("greets a new customer with the main menu and stores the session", async () => {
    await send(fixtures.textMessageWebhook("hi", h.base));
    const msgs = h.sender.to("971500000001");
    expect(msgs).toHaveLength(1);
    expect(bodyOf(msgs[0])).toBe("Welcome to Demo Restaurant! How can we help you today?");
    const session = await h.sessions.get("tenant_seed", "971500000001");
    expect(session?.awaiting).toBe(true);
    expect(h.conversations.messages.filter((m) => m.direction === "in")).toHaveLength(1);
    expect(h.conversations.messages.filter((m) => m.direction === "out")).toHaveLength(1);
  });

  it("walks a complete pickup order: modifiers, quantity, quote, confirmation", async () => {
    await send(fixtures.textMessageWebhook("hi", h.base));
    await send(fixtures.buttonReplyWebhook("order_food", "Order food", h.base));
    await send(fixtures.listReplyWebhook("cat_shawarma", "Shawarma", h.base));
    await send(fixtures.listReplyWebhook("it_chicken_shawarma", "Chicken Shawarma", h.base));
    await send(fixtures.listReplyWebhook("sh_chk_size_large", "Large", h.base));
    await send(fixtures.listReplyWebhook("__skip", "No thanks", h.base));
    await send(fixtures.textMessageWebhook("2", h.base));
    await send(fixtures.buttonReplyWebhook("checkout", "Checkout", h.base));
    await send(fixtures.buttonReplyWebhook("pickup", "Pickup", h.base));
    await send(fixtures.buttonReplyWebhook("confirm", "Confirm order", h.base));

    const bodies = h.sender.to("971500000001").map(bodyOf);
    expect(bodies[1]).toBe("What would you like to order?");
    expect(bodies[2]).toBe("Shawarma: pick an item");
    expect(bodies[3]).toBe("Chicken Shawarma: Size");
    expect(bodies[4]).toBe("Chicken Shawarma: Extras");
    expect(bodies[5]).toContain("How many Chicken Shawarma?");
    expect(bodies[6]).toBe("Added. Your cart has 2 item(s), AED 46.00.");
    expect(bodies[7]).toBe("How would you like to get your order?");
    expect(bodies[8]).toBe("2 x Chicken Shawarma (Large)  AED 46.00\n\nSubtotal: AED 46.00\nTotal: AED 46.00\n(Includes VAT AED 2.19)");
    expect(bodies[9]).toBe("Shall we place this order?");
    expect(bodies[10]).toBe("Order #1 placed. Thank you! Please pay AED 46.00 when you collect your order. We will message you here as your order progresses.");

    expect(h.orders.orders).toHaveLength(1);
    const order = h.orders.orders[0]!;
    expect(order).toMatchObject({ status: "placed", fulfillmentType: "pickup", totalMinor: 4600, paymentMethod: "cash", source: "whatsapp" });
    expect(order.items[0]).toMatchObject({ offeringId: "it_chicken_shawarma", quantity: 2, modifiers: [{ optionId: "sh_chk_size_large", priceDeltaMinor: 500 }] });
    expect(h.eventBus.published.map((e) => e.type)).toEqual(["order.placed"]);
    expect(await h.sessions.get("tenant_seed", "971500000001")).toBeNull();
  });

  it("charges a delivery fee and stores the location on delivery orders", async () => {
    await send(fixtures.textMessageWebhook("hi", h.base));
    await send(fixtures.buttonReplyWebhook("order_food", "Order food", h.base));
    await send(fixtures.listReplyWebhook("cat_burgers", "Burgers", h.base));
    await send(fixtures.listReplyWebhook("it_classic_burger", "Classic Burger", h.base));
    await send(fixtures.textMessageWebhook("1", h.base));
    await send(fixtures.buttonReplyWebhook("checkout", "Checkout", h.base));
    await send(fixtures.buttonReplyWebhook("delivery", "Delivery", h.base));
    await send(fixtures.locationWebhook(25.08, 55.14, h.base));
    await send(fixtures.textMessageWebhook("Marina Tower, flat 1203", h.base));
    await send(fixtures.buttonReplyWebhook("confirm", "Confirm order", h.base));

    const order = h.orders.orders[0]!;
    expect(order).toMatchObject({ fulfillmentType: "delivery", subtotalMinor: 3200, deliveryFeeMinor: 1000, totalMinor: 4200 });
    expect(order.deliveryLocation).toMatchObject({ latitude: 25.08, longitude: 55.14, notes: "Marina Tower, flat 1203" });
    const bodies = h.sender.to("971500000001").map(bodyOf);
    expect(bodies.at(-3)).toContain("Delivery: AED 10.00");
    expect(bodies.at(-1)).toContain("pay AED 42.00 in cash on delivery");
  });

  it("keeps the cart when the customer jumps to 'menu' or 'cart' mid-order", async () => {
    await send(fixtures.textMessageWebhook("hi", h.base));
    await send(fixtures.buttonReplyWebhook("order_food", "Order food", h.base));
    await send(fixtures.listReplyWebhook("cat_sides", "Sides", h.base));
    await send(fixtures.listReplyWebhook("it_fries", "Fries", h.base));
    await send(fixtures.textMessageWebhook("3", h.base));
    await send(fixtures.textMessageWebhook("menu", h.base));
    await send(fixtures.textMessageWebhook("cart", h.base));
    const last = bodyOf(h.sender.to("971500000001").at(-1));
    expect(last).toBe("Your cart:\n3 x Fries  AED 36.00\n\nSubtotal: AED 36.00");
  });

  it("reports the latest order status on 'track my order'", async () => {
    await send(fixtures.textMessageWebhook("hi", h.base));
    await send(fixtures.buttonReplyWebhook("track_order", "Track my order", h.base));
    expect(bodyOf(h.sender.to("971500000001").at(-1))).toContain("You have no recent orders");

    await send(fixtures.textMessageWebhook("menu", h.base));
    await send(fixtures.buttonReplyWebhook("order_food", "Order food", h.base));
    await send(fixtures.listReplyWebhook("cat_drinks", "Drinks", h.base));
    await send(fixtures.listReplyWebhook("it_lemon_mint", "Lemon Mint", h.base));
    await send(fixtures.textMessageWebhook("1", h.base));
    await send(fixtures.buttonReplyWebhook("checkout", "Checkout", h.base));
    await send(fixtures.buttonReplyWebhook("pickup", "Pickup", h.base));
    await send(fixtures.buttonReplyWebhook("confirm", "Confirm order", h.base));
    await send(fixtures.textMessageWebhook("menu", h.base));
    await send(fixtures.buttonReplyWebhook("track_order", "Track my order", h.base));
    expect(bodyOf(h.sender.to("971500000001").at(-1))).toBe("Order #1 is received and waiting for confirmation. Total AED 15.00.");
  });

  it("cancelling at confirmation clears the cart", async () => {
    await send(fixtures.textMessageWebhook("hi", h.base));
    await send(fixtures.buttonReplyWebhook("order_food", "Order food", h.base));
    await send(fixtures.listReplyWebhook("cat_sides", "Sides", h.base));
    await send(fixtures.listReplyWebhook("it_hummus", "Hummus", h.base));
    await send(fixtures.textMessageWebhook("1", h.base));
    await send(fixtures.buttonReplyWebhook("checkout", "Checkout", h.base));
    await send(fixtures.buttonReplyWebhook("pickup", "Pickup", h.base));
    await send(fixtures.buttonReplyWebhook("cancel", "Cancel", h.base));
    expect(bodyOf(h.sender.to("971500000001").at(-1))).toContain("the order was cancelled");
    expect(h.orders.orders).toHaveLength(0);
  });

  it("drops duplicate webhook deliveries", async () => {
    const payload = fixtures.textMessageWebhook("hi", { ...h.base, messageId: "wamid.dup" });
    await send(payload);
    await send(payload);
    expect(h.sender.to("971500000001")).toHaveLength(1);
  });

  it("ignores numbers that belong to no tenant", async () => {
    await send(fixtures.textMessageWebhook("hi", { ...h.base, phoneNumberId: "999" }));
    expect(h.sender.sent).toHaveLength(0);
  });

  it("detects Arabic on first contact and remembers it", async () => {
    await send(fixtures.textMessageWebhook("مرحبا", h.base));
    expect(bodyOf(h.sender.to("971500000001")[0])).toContain("أهلاً بك في Demo Restaurant");
    const customer = await h.conversations.upsertCustomer("tenant_seed", "971500000001");
    expect(customer.language).toBe("ar");
  });

  it("goes quiet after handoff and resumes on 'menu'", async () => {
    await send(fixtures.textMessageWebhook("agent", h.base));
    expect(bodyOf(h.sender.to("971500000001")[0])).toBe("One of our team will reply here shortly.");
    const conv = [...h.conversations.conversations.values()][0];
    expect(conv?.status).toBe("human");

    await send(fixtures.textMessageWebhook("is anyone there?", h.base));
    expect(h.sender.to("971500000001")).toHaveLength(1);

    await send(fixtures.textMessageWebhook("menu", h.base));
    expect(h.sender.to("971500000001")).toHaveLength(2);
    expect(conv?.status).toBe("bot");
  });

  it("restarts from the entry flow when a session has ended", async () => {
    await send(fixtures.textMessageWebhook("agent", h.base));
    await send(fixtures.textMessageWebhook("menu", h.base));
    await send(fixtures.textMessageWebhook("random words", h.base));
    const bodies = h.sender.to("971500000001").map(bodyOf);
    expect(bodies[2]).toBe("Please tap one of the buttons, or type 1, 2 or 3.");
  });

  it("stores what a guided-style customer sent as media, and the flow carries on as before", async () => {
    await send(fixtures.mediaMessageWebhook("audio", { id: "media_1", mimeType: "audio/ogg; codecs=opus" }, h.base));
    const stored = h.conversations.messages.find((m) => m.direction === "in");
    expect(stored).toMatchObject({ kind: "media", payload: { mediaType: "audio", mediaId: "media_1", text: "[sent a voice note]", handling: "not_transcribed" } });
    expect(bodyOf(h.sender.to("971500000001")[0])).toBe("Welcome to Demo Restaurant! How can we help you today?");
    // Guided style never fetches media: the flows cannot use it.
    expect(h.sender.downloads).toEqual([]);
  });

  it("records delivery statuses", async () => {
    await send(fixtures.textMessageWebhook("hi", h.base));
    const outId = h.sender.sent[0]!.providerMessageId;
    await send(fixtures.statusWebhook(outId, "delivered", h.base));
    expect(h.conversations.statuses.get(outId)).toBe("delivered");
  });
});
