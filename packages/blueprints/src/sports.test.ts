import { FlowRunner, MapActionRegistry } from "@ordr/flow-schema";
import type { InboundContent, OutboundMessage } from "@ordr/whatsapp";
import { describe, expect, it } from "vitest";
import { blueprints, sports } from "./index";

function body(m: OutboundMessage | undefined): string {
  if (!m) return "";
  if (m.type === "text") return m.text.body;
  if (m.type === "interactive" && "body" in m.interactive) return m.interactive.body.text;
  return m.type;
}

function stubActions() {
  return new MapActionRegistry()
    .register("booking.services", async () => [{ id: "svc_padel_60", title: "Padel 60 min", description: "AED 200.00 · 60 min" }])
    .register("booking.staff", async () => [
      { id: "any", title: "Any free court" },
      { id: "res_padel_1", title: "Padel Court 1" },
    ])
    .register("booking.days", async () => [{ id: "2026-11-06", title: "Fri 6 Nov" }])
    .register("booking.slots", async () => [{ id: "2026-11-06T16:00:00.000Z|res_padel_1", title: "20:00", description: "Padel Court 1" }])
    .register("booking.create", async () => ({ id: "ord_1", number: 7, text: "Booked! Padel 60 min on *Padel Court 1*." }));
}

const actionCtx = { tenantId: "t1", customer: { id: "c1", waId: "971500000001", name: "Noor" } };
const context = { tenant: { name: "Demo Courts" }, customer: { name: "Noor" } };
const btn = (id: string): InboundContent => ({ kind: "button", id, title: id });
const row = (id: string): InboundContent => ({ kind: "list", id, title: id });

describe("sports blueprint", () => {
  it("is registered, and a court is confirmed the moment it is booked", () => {
    expect(blueprints.sports).toBe(sports);
    expect(sports.flows.map((f) => f.id).sort()).toEqual(["book_court", "language", "main_menu", "my_bookings", "photos", "talk_to_us"]);
    expect(sports.offeringType).toBe("service");
    expect(sports.orderStates.initial).toBe("confirmed");
    expect(sports.orderStates.states).not.toContain("requested");
    expect(sports.settings).toMatchObject({ resourceNoun: "court", bufferMinutes: 0, conversationStyle: "natural" });
  });

  it("books a court through the guided flow, in court words", async () => {
    const runner = new FlowRunner(sports, stubActions());
    let r = await runner.start("main_menu", { language: "en", context }, actionCtx);
    expect(JSON.stringify(r.outbound[0])).toContain("Book a court");

    r = await runner.resume(r.session!, btn("book"), actionCtx);
    expect(body(r.outbound[0])).toBe("What would you like to play?");
    r = await runner.resume(r.session!, row("svc_padel_60"), actionCtx);
    expect(body(r.outbound[0])).toBe("Padel 60 min: which court?");
    r = await runner.resume(r.session!, row("res_padel_1"), actionCtx);
    expect(body(r.outbound[0])).toBe("Which day suits you?");
    r = await runner.resume(r.session!, row("2026-11-06"), actionCtx);
    r = await runner.resume(r.session!, btn("evening"), actionCtx);
    r = await runner.resume(r.session!, row("2026-11-06T16:00:00.000Z|res_padel_1"), actionCtx);
    expect(body(r.outbound[0])).toBe("Padel 60 min, Fri 6 Nov at 20:00 (Padel Court 1). Shall we book it?");
    r = await runner.resume(r.session!, btn("confirm"), actionCtx);
    expect(body(r.outbound[0])).toBe("Booked! Padel 60 min on *Padel Court 1*.");
    expect(r.completed).toBe(true);
  });
});
