import { describe, expect, it } from "vitest";
import { resort } from "./resort";

describe("resort blueprint", () => {
  it("parses as a stay vertical with a hotel-style state machine and the properties module", () => {
    expect(resort.offeringType).toBe("stay");
    expect(resort.flows.map((f) => f.id).sort()).toEqual(["language", "main_menu", "photos", "talk_to_us"]);
    expect(resort.orderStates.initial).toBe("requested");
    expect(resort.orderStates.transitions.find((t) => t.from === "checked_in")).toEqual({ from: "checked_in", to: "checked_out", on: "check_out" });
    expect(resort.dashboardModules).toContain("properties");
    expect(resort.settings).toMatchObject({ conversationStyle: "natural", maxNights: 30, maxAdvanceDays: 365 });
    expect(resort.globalCommands.find((g) => g.flow === "photos")?.keywords).toContain("rooms");
  });
});
