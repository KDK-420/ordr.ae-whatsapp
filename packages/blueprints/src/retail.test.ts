import { describe, expect, it } from "vitest";
import { retail } from "./retail";

describe("retail blueprint", () => {
  it("parses with the commerce order states and natural style", () => {
    expect(retail.id).toBe("retail");
    expect(retail.orderStates.initial).toBe("pending_payment");
    expect(retail.orderStates.transitions.some((t) => t.from === "pending_payment" && t.to === "paid")).toBe(true);
    expect((retail.settings as Record<string, unknown>).conversationStyle).toBe("natural");
    expect(retail.flows.map((f) => f.id)).toContain("main_menu");
  });
});
