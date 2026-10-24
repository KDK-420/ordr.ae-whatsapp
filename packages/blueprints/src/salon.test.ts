import { FlowRunner, MapActionRegistry } from "@ordr/flow-schema";
import type { InboundContent, OutboundMessage } from "@ordr/whatsapp";
import { describe, expect, it } from "vitest";
import { salon } from "./salon";

function body(m: OutboundMessage | undefined): string {
  if (!m) return "";
  if (m.type === "text") return m.text.body;
  if (m.type === "interactive" && "body" in m.interactive) return m.interactive.body.text;
  return m.type;
}

function stubActions(opts: { slots?: boolean; upcoming?: number } = { slots: true, upcoming: 1 }) {
  return new MapActionRegistry()
    .register("booking.services", async () => [{ id: "svc_haircut", title: "Haircut", description: "AED 80.00 · 45 min" }])
    .register("booking.staff", async () => [
      { id: "any", title: "Anyone available" },
      { id: "res_sara", title: "Sara" },
    ])
    .register("booking.days", async () => [{ id: "2026-10-20", title: "Tue 20 Oct" }])
    .register("booking.slots", async () => (opts.slots ? [{ id: "2026-10-20T07:00:00.000Z|res_sara", title: "11:00", description: "Sara" }] : []))
    .register("booking.create", async (p) => ({ id: "ord_1", number: 1, text: `Booked ${String(p.serviceId)} at ${String(p.slotId)}` }))
    .register("booking.upcoming", async () => ({
      count: opts.upcoming ?? 0,
      rows: opts.upcoming ? [{ id: "ord_1", title: "Tue 20 Oct, 11:00", description: "Haircut · Sara · confirmed" }] : [],
      text: "",
    }))
    .register("booking.cancel", async (p) => ({ cancelled: true, text: `Cancelled ${String(p.orderId)}` }));
}

const actionCtx = { tenantId: "t1", customer: { id: "c1", waId: "971500000001", name: "Sara" } };
const context = { tenant: { name: "Demo Salon" }, customer: { name: "Sara" } };
const btn = (id: string): InboundContent => ({ kind: "button", id, title: id });
const row = (id: string): InboundContent => ({ kind: "list", id, title: id });
const txt = (text: string): InboundContent => ({ kind: "text", text });

describe("salon blueprint", () => {
  it("parses with the booking state machine and flows", () => {
    expect(salon.flows.map((f) => f.id).sort()).toEqual(["book_service", "language", "main_menu", "my_bookings", "photos", "talk_to_us"]);
    expect(salon.orderStates.initial).toBe("requested");
    expect(salon.globalCommands.find((g) => g.flow === "my_bookings")?.keywords).toContain("bookings");
  });

  it("books a service: service, staff, day, period, time, confirmation", async () => {
    const runner = new FlowRunner(salon, stubActions());
    let r = await runner.start("main_menu", { language: "en", context }, actionCtx);
    expect(body(r.outbound[0])).toBe("Welcome to Demo Salon! What would you like to do?");
    r = await runner.resume(r.session!, btn("book"), actionCtx);
    expect(body(r.outbound[0])).toBe("Which service would you like?");
    r = await runner.resume(r.session!, row("svc_haircut"), actionCtx);
    expect(body(r.outbound[0])).toBe("Haircut: who would you like it with?");
    r = await runner.resume(r.session!, row("any"), actionCtx);
    expect(body(r.outbound[0])).toBe("Which day suits you?");
    r = await runner.resume(r.session!, row("2026-10-20"), actionCtx);
    expect(body(r.outbound[0])).toBe("Tue 20 Oct: what time of day?");
    r = await runner.resume(r.session!, btn("morning"), actionCtx);
    expect(body(r.outbound[0])).toBe("Pick a time:");
    r = await runner.resume(r.session!, row("2026-10-20T07:00:00.000Z|res_sara"), actionCtx);
    expect(body(r.outbound[0])).toBe("Haircut with Anyone available on Tue 20 Oct at 11:00. Shall we book it?");
    r = await runner.resume(r.session!, btn("confirm"), actionCtx);
    expect(body(r.outbound[0])).toBe("Booked svc_haircut at 2026-10-20T07:00:00.000Z|res_sara");
    expect(r.completed).toBe(true);
  });

  it("asks for another part of the day when there are no slots, and typed numbers work", async () => {
    const runner = new FlowRunner(salon, stubActions({ slots: false }));
    let r = await runner.start("book_service", { language: "en", context }, actionCtx);
    r = await runner.resume(r.session!, txt("1"), actionCtx);
    r = await runner.resume(r.session!, txt("2"), actionCtx);
    r = await runner.resume(r.session!, txt("1"), actionCtx);
    r = await runner.resume(r.session!, btn("evening"), actionCtx);
    expect(body(r.outbound[0])).toBe("No free times in that part of the day. Let's try another.");
    expect(body(r.outbound[1])).toBe("Tue 20 Oct: what time of day?");
    expect(r.session?.nodeId).toBe("ask_period");
  });

  it("lists upcoming bookings and cancels one", async () => {
    const runner = new FlowRunner(salon, stubActions({ slots: true, upcoming: 1 }));
    let r = await runner.start("my_bookings", { language: "en", context }, actionCtx);
    expect(body(r.outbound[0])).toBe("Your upcoming bookings:");
    r = await runner.resume(r.session!, row("ord_1"), actionCtx);
    expect(body(r.outbound[0])).toBe("Tue 20 Oct, 11:00. What would you like to do?");
    r = await runner.resume(r.session!, btn("cancel"), actionCtx);
    expect(body(r.outbound[0])).toBe("Cancelled ord_1");
    const none = await new FlowRunner(salon, stubActions({ upcoming: 0 })).start("my_bookings", { language: "ar", context }, actionCtx);
    expect(none.completed).toBe(true);
    expect(body(none.outbound[0])).toContain("ليس لديك حجوزات قادمة");
  });

  it("speaks Arabic", async () => {
    const runner = new FlowRunner(salon, stubActions());
    const r = await runner.start("main_menu", { language: "ar", context }, actionCtx);
    expect(body(r.outbound[0])).toBe("أهلاً بك في Demo Salon! ماذا تود أن تفعل؟");
  });
});
