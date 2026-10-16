import type { DomainEvent } from "@ordr/domain";
import { describe, expect, it } from "vitest";
import { InMemoryEventBus, InMemoryOutboxStore } from "../adapters/memory-catalog";
import { loadConfig } from "../config";
import { backoffMs, OutboxRelay } from "./outbox-relay";

const event = (id: string, type = "order.status_changed"): DomainEvent => ({
  id,
  type,
  tenantId: "t1",
  occurredAt: new Date(2026, 9, 16, 12, 0, 0).toISOString(),
  subject: { kind: "order", id: `ord_${id}` },
  payload: { to: "accepted" },
});

function setup(maxAttempts = 3) {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", OUTBOX_MAX_ATTEMPTS: String(maxAttempts), OUTBOX_BATCH_SIZE: "10" });
  const store = new InMemoryOutboxStore();
  const bus = new InMemoryEventBus();
  const relay = new OutboxRelay(config, store, bus);
  return { config, store, bus, relay };
}

describe("OutboxRelay", () => {
  it("dispatches due events to handlers and marks them sent", async () => {
    const { store, bus, relay } = setup();
    const seen: string[] = [];
    bus.subscribe("order.status_changed", (e) => void seen.push(e.id));
    const now = new Date();
    store.add(event("a"), now);
    store.add(event("b"), now);
    store.add(event("later"), new Date(now.getTime() + 60_000));
    expect(await relay.tick(now)).toBe(2);
    expect(seen).toEqual(["a", "b"]);
    expect(await store.counts()).toEqual({ sent: 2, pending: 1 });
  });

  it("retries a failing handler with backoff and parks it after the last attempt", async () => {
    const { store, bus, relay } = setup(3);
    let calls = 0;
    bus.subscribe("*", () => {
      calls += 1;
      throw new Error("WhatsApp down");
    });
    const t0 = new Date();
    store.add(event("x"), t0);

    expect(await relay.tick(t0)).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: "pending", attempts: 1, lastError: "WhatsApp down" });
    expect(store.rows[0]!.nextAttemptAt).toBe(t0.getTime() + backoffMs(1));

    // Not due yet.
    expect(await relay.tick(new Date(t0.getTime() + 500))).toBe(0);

    const t1 = new Date(t0.getTime() + backoffMs(1));
    expect(await relay.tick(t1)).toBe(1);
    const t2 = new Date(t1.getTime() + backoffMs(2));
    expect(await relay.tick(t2)).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(calls).toBe(3);
    expect(await relay.tick(new Date(t2.getTime() + 60 * 60_000))).toBe(0);
  });

  it("succeeds on a later attempt when the handler recovers", async () => {
    const { store, bus, relay } = setup(5);
    let fail = true;
    bus.subscribe("*", () => {
      if (fail) throw new Error("transient");
    });
    const t0 = new Date();
    store.add(event("y"), t0);
    await relay.tick(t0);
    fail = false;
    await relay.tick(new Date(t0.getTime() + backoffMs(1)));
    expect(store.rows[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("returns stale claims to pending so a crashed worker's batch is not lost", async () => {
    const { store, relay, bus } = setup();
    const delivered: string[] = [];
    bus.subscribe("*", (e) => void delivered.push(e.id));
    const t0 = new Date();
    store.add(event("z"), t0);
    await store.claim(10, t0); // claimed but never resolved
    expect(await relay.tick(new Date(t0.getTime() + 60_000))).toBe(0);
    expect(await relay.tick(new Date(t0.getTime() + 6 * 60_000))).toBe(1);
    expect(delivered).toEqual(["z"]);
  });

  it("caps the backoff", () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(30)).toBe(5 * 60_000);
  });
});
