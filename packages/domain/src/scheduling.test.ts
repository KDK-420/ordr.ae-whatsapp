import { describe, expect, it } from "vitest";
import { addDays, canServe, generateSlots, hoursOn, localDateKey, localTime, tzOffsetMinutes, weekdayOf, zonedToUtc } from "./scheduling";

const TZ = "Asia/Dubai";
const at = (iso: string) => new Date(iso);

describe("time zone helpers", () => {
  it("converts Dubai wall-clock time to instants and back", () => {
    expect(tzOffsetMinutes(TZ, at("2026-10-20T06:00:00Z"))).toBe(240);
    expect(zonedToUtc("2026-10-20", "10:00", TZ).toISOString()).toBe("2026-10-20T06:00:00.000Z");
    expect(localDateKey(at("2026-10-20T21:30:00Z"), TZ)).toBe("2026-10-21");
    expect(localTime(at("2026-10-20T21:30:00Z"), TZ)).toBe("01:30");
    expect(localTime(at("2026-10-20T20:00:00Z"), TZ)).toBe("00:00");
  });

  it("handles a zone with daylight saving", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", "Europe/London").toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("knows weekdays and date arithmetic", () => {
    expect(weekdayOf("2026-10-20")).toBe("tue");
    expect(weekdayOf("2026-10-25")).toBe("sun");
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(hoursOn({ tue: [{ start: "10:00", end: "20:00" }] }, "2026-10-20")).toHaveLength(1);
    expect(hoursOn({ tue: [{ start: "10:00", end: "20:00" }] }, "2026-10-21")).toEqual([]);
  });
});

describe("generateSlots", () => {
  const base = { date: "2026-10-20", tz: TZ, hours: [{ start: "10:00", end: "14:00" }], stepMinutes: 30, durationMinutes: 45, bufferMinutes: 0, busy: [], now: at("2026-10-01T00:00:00Z"), leadMinutes: 0 };
  const times = (slots: Date[]) => slots.map((s) => localTime(s, TZ));

  it("steps through working hours and keeps the whole service inside them", () => {
    expect(times(generateSlots(base))).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00"]);
  });

  it("skips slots that collide with bookings, including the buffer around them", () => {
    const busy = [{ start: zonedToUtc("2026-10-20", "11:00", TZ), end: zonedToUtc("2026-10-20", "11:45", TZ) }];
    expect(times(generateSlots({ ...base, busy }))).toEqual(["10:00", "12:00", "12:30", "13:00"]);
    expect(times(generateSlots({ ...base, busy, bufferMinutes: 10 }))).toEqual(["10:00", "12:00", "12:30", "13:00"]);
    expect(times(generateSlots({ ...base, busy, bufferMinutes: 20 }))).toEqual(["12:30", "13:00"]);
  });

  it("respects lead time from now", () => {
    const now = zonedToUtc("2026-10-20", "10:20", TZ);
    expect(times(generateSlots({ ...base, now, leadMinutes: 60 }))).toEqual(["11:30", "12:00", "12:30", "13:00"]);
  });

  it("handles split shifts and closed days", () => {
    const hours = [
      { start: "09:00", end: "10:00" },
      { start: "16:00", end: "17:30" },
    ];
    expect(times(generateSlots({ ...base, hours }))).toEqual(["09:00", "16:00", "16:30"]);
    expect(generateSlots({ ...base, hours: [] })).toEqual([]);
  });
});

describe("canServe", () => {
  it("treats empty skills as every service and respects inactive resources", () => {
    expect(canServe({ skills: [], isActive: true }, "svc_cut")).toBe(true);
    expect(canServe({ skills: ["svc_color"], isActive: true }, "svc_cut")).toBe(false);
    expect(canServe({ skills: ["svc_cut"], isActive: false }, "svc_cut")).toBe(false);
  });
});
