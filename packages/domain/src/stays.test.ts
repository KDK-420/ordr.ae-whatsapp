import { describe, expect, it } from "vitest";
import { freeUnits, nightCount, nightsBetween } from "./stays";

describe("stays", () => {
  it("counts nights from check-in up to check-out", () => {
    expect(nightsBetween("2026-12-24", "2026-12-27")).toEqual(["2026-12-24", "2026-12-25", "2026-12-26"]);
    expect(nightCount("2026-12-24", "2026-12-24")).toBe(0);
    expect(nightCount("2026-12-31", "2027-01-02")).toBe(2);
  });

  it("takes the busiest night, and same-day turnover does not collide", () => {
    const d = (s: string) => new Date(s);
    const wanted = { startAt: d("2026-12-24T11:00:00Z"), endAt: d("2026-12-27T08:00:00Z") };
    const nights = [d("2026-12-24T11:00:00Z"), d("2026-12-25T11:00:00Z"), d("2026-12-26T11:00:00Z")];
    // Two rooms. One stay covers nights 1-2, another covers night 3 only: never more than one taken per night.
    const occupied = [
      { startAt: d("2026-12-24T11:00:00Z"), endAt: d("2026-12-26T08:00:00Z") },
      { startAt: d("2026-12-26T11:00:00Z"), endAt: d("2026-12-27T08:00:00Z") },
    ];
    expect(freeUnits(2, wanted, occupied, nights)).toBe(1);
    // A third stay over night 2 fills both rooms on that night.
    expect(freeUnits(2, wanted, [...occupied, { startAt: d("2026-12-25T11:00:00Z"), endAt: d("2026-12-26T08:00:00Z") }], nights)).toBe(0);
    // A stay checking out the morning of our check-in does not count.
    expect(freeUnits(1, wanted, [{ startAt: d("2026-12-22T11:00:00Z"), endAt: d("2026-12-24T08:00:00Z") }], nights)).toBe(1);
  });
});
