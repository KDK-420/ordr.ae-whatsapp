import type { LocalizedText } from "./catalog";
import type { ResourceId, TenantId } from "./ids";

/** "HH:mm" to "HH:mm" in the tenant's local time. */
export interface TimeRange {
  start: string;
  end: string;
}

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Working hours per weekday; a missing or empty day means closed. */
export type WeeklyHours = Partial<Record<Weekday, TimeRange[]>>;

/** Someone or something a booking occupies: a stylist, a chair, a room. */
export interface Resource {
  id: ResourceId;
  tenantId: TenantId;
  type: "staff" | "room" | "asset";
  name: LocalizedText;
  hours: WeeklyHours;
  /** Offering ids this resource can serve; empty means every service. */
  skills: string[];
  sortOrder: number;
  isActive: boolean;
}

export class SlotTakenError extends Error {
  constructor(message = "that time was just taken") {
    super(message);
    this.name = "SlotTakenError";
  }
}

// ---------------------------------------------------------------------------
// Time zone helpers. Tenants are in the Gulf (no DST) today, but nothing here assumes that.
// ---------------------------------------------------------------------------

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsCache.set(tz, f);
  }
  return f;
}

function localParts(at: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(at)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { year: out.year!, month: out.month!, day: out.day!, hour: out.hour! % 24, minute: out.minute!, second: out.second! };
}

/** Offset of `tz` from UTC at the given instant, in minutes (Asia/Dubai is 240). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const p = localParts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant at which the wall clock in `tz` reads `date` (YYYY-MM-DD) and `time` (HH:mm). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two passes handle the offset changing between the naive guess and the real instant (DST edges).
  let guess = naive - tzOffsetMinutes(tz, new Date(naive)) * 60_000;
  guess = naive - tzOffsetMinutes(tz, new Date(guess)) * 60_000;
  return new Date(guess);
}

/** YYYY-MM-DD of the instant in `tz`. */
export function localDateKey(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** HH:mm of the instant in `tz`. */
export function localTime(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function weekdayOf(dateKey: string): Weekday {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]!;
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface Busy {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  /** Calendar day in the tenant's zone. */
  date: string;
  tz: string;
  /** Working ranges for that day (already picked from WeeklyHours). */
  hours: TimeRange[];
  stepMinutes: number;
  durationMinutes: number;
  /** Kept free before and after every existing booking. */
  bufferMinutes: number;
  busy: Busy[];
  now: Date;
  /** Earliest bookable start is now + lead. */
  leadMinutes: number;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Slot start instants on `date` where a booking of `durationMinutes` fits. */
export function generateSlots(q: SlotQuery): Date[] {
  const earliest = q.now.getTime() + q.leadMinutes * 60_000;
  const busy = q.busy.map((b) => ({ start: new Date(b.start.getTime() - q.bufferMinutes * 60_000), end: new Date(b.end.getTime() + q.bufferMinutes * 60_000) }));
  const out: Date[] = [];
  for (const range of q.hours) {
    const open = zonedToUtc(q.date, range.start, q.tz).getTime();
    const close = zonedToUtc(q.date, range.end, q.tz).getTime();
    for (let start = open; start + q.durationMinutes * 60_000 <= close; start += q.stepMinutes * 60_000) {
      if (start < earliest) continue;
      const s = new Date(start);
      const e = new Date(start + q.durationMinutes * 60_000);
      if (busy.some((b) => overlaps(s, e, b.start, b.end))) continue;
      out.push(s);
    }
  }
  return out;
}

/** Working ranges of a resource on a calendar day. */
export function hoursOn(hours: WeeklyHours, dateKey: string): TimeRange[] {
  return hours[weekdayOf(dateKey)] ?? [];
}

/** Whether the resource can serve the offering (empty skills means everything). */
export function canServe(resource: Pick<Resource, "skills" | "isActive">, offeringId: string): boolean {
  return resource.isActive && (resource.skills.length === 0 || resource.skills.includes(offeringId));
}
