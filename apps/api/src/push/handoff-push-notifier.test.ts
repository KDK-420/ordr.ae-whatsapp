import { describe, expect, it } from "vitest";
import { InMemoryPushSubscriptionRepository } from "../adapters/memory-commerce";
import { InMemoryEventBus } from "../adapters/memory-catalog";
import type { HandedOverPayload } from "../conversation/conversation.service";
import { HandoffPushNotifier } from "./handoff-push-notifier";
import { FakeWebPushSender, VapidWebPushSender } from "./web-push";

const TENANT = "tenant_seed";
const keys = { p256dh: "p", auth: "a" };

function setup() {
  const bus = new InMemoryEventBus();
  const sender = new FakeWebPushSender();
  const subscriptions = new InMemoryPushSubscriptionRepository();
  new HandoffPushNotifier(bus, sender, subscriptions).onModuleInit();
  const payload: HandedOverPayload = { conversationId: "conv_1", customerId: "cust_1", customerName: "Sunil", waId: "971585884950", channelId: "ch_real", preview: "I want to talk to a person about my refund", reason: "refund" };
  const handedOver = (p: Partial<HandedOverPayload> = {}) =>
    bus.publish({ id: `evt_${Math.random()}`, type: "conversation.handed_over", tenantId: TENANT, occurredAt: new Date().toISOString(), subject: { kind: "conversation", id: "conv_1" }, payload: { ...payload, ...p } });
  return { sender, subscriptions, handedOver };
}

describe("HandoffPushNotifier", () => {
  it("pushes to every device of the tenant's users and nobody else's", async () => {
    const h = setup();
    await h.subscriptions.upsert({ userId: "u1", tenantId: TENANT, endpoint: "https://push.example/u1-phone", keys });
    await h.subscriptions.upsert({ userId: "u2", tenantId: TENANT, endpoint: "https://push.example/u2-laptop", keys });
    await h.subscriptions.upsert({ userId: "u9", tenantId: "tenant_other", endpoint: "https://push.example/other", keys });

    await h.handedOver();

    expect(h.sender.sent.map((s) => s.target.endpoint)).toEqual(["https://push.example/u1-phone", "https://push.example/u2-laptop"]);
    expect(h.sender.sent[0]?.payload).toEqual({ title: "Sunil needs a person", body: "I want to talk to a person about my refund", url: "/inbox", tag: "handoff-conv_1" });
  });

  it("falls back to the number when the customer has no name", async () => {
    const h = setup();
    await h.subscriptions.upsert({ userId: "u1", tenantId: TENANT, endpoint: "https://push.example/u1", keys });
    await h.handedOver({ customerName: undefined });
    expect(h.sender.sent[0]?.payload.title).toBe("+971585884950 needs a person");
  });

  it("deletes subscriptions the push service reports gone and keeps the rest", async () => {
    const h = setup();
    await h.subscriptions.upsert({ userId: "u1", tenantId: TENANT, endpoint: "https://push.example/gone-410", keys });
    await h.subscriptions.upsert({ userId: "u1", tenantId: TENANT, endpoint: "https://push.example/gone-404", keys });
    await h.subscriptions.upsert({ userId: "u1", tenantId: TENANT, endpoint: "https://push.example/flaky-500", keys });
    await h.subscriptions.upsert({ userId: "u2", tenantId: TENANT, endpoint: "https://push.example/ok", keys });
    h.sender.failWith.set("https://push.example/gone-410", 410);
    h.sender.failWith.set("https://push.example/gone-404", 404);
    h.sender.failWith.set("https://push.example/flaky-500", 500);

    await expect(h.handedOver()).resolves.toBeUndefined();

    expect(h.sender.sent.map((s) => s.target.endpoint)).toEqual(["https://push.example/ok"]);
    expect((await h.subscriptions.listByTenant(TENANT)).map((s) => s.endpoint)).toEqual(["https://push.example/flaky-500", "https://push.example/ok"]);
  });

  it("does nothing when push is not configured", async () => {
    const h = setup();
    Object.assign(h.sender, { enabled: false });
    await h.subscriptions.upsert({ userId: "u1", tenantId: TENANT, endpoint: "https://push.example/u1", keys });
    await h.handedOver();
    expect(h.sender.sent).toHaveLength(0);
  });

  it("the real sender is off without both VAPID keys", () => {
    expect(new VapidWebPushSender({ WEB_PUSH_PUBLIC_KEY: "pub", WEB_PUSH_PRIVATE_KEY: undefined, WEB_PUSH_SUBJECT: "mailto:a@b.c" }).enabled).toBe(false);
    const on = new VapidWebPushSender({ WEB_PUSH_PUBLIC_KEY: "pub", WEB_PUSH_PRIVATE_KEY: "priv", WEB_PUSH_SUBJECT: "mailto:a@b.c" });
    expect(on.enabled).toBe(true);
    expect(on.publicKey).toBe("pub");
  });
});
