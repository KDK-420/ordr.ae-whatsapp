import { addDays } from "./scheduling";

/**
 * Night-based availability for stays. A room type has `units` identical rooms; a stay occupies
 * one unit from its check-in night up to (not including) the check-out date. Availability over a
 * range is the fewest free units on any night in it.
 */

export interface StayRange {
  /** Check-in instant. */
  startAt: Date;
  /** Check-out instant. */
  endAt: Date;
}

/** Calendar nights (YYYY-MM-DD of the night's date) a stay from checkIn to checkOut occupies. */
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = checkIn; d < checkOut && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function nightCount(checkIn: string, checkOut: string): number {
  return nightsBetween(checkIn, checkOut).length;
}

/**
 * Free units on the busiest night of [startAt, endAt), given everything that occupies the room
 * type in that window. Two stays overlap a night when their instants overlap; a check-out at noon
 * and a check-in at 15:00 on the same day do not overlap, so the room turns over the same day.
 */
export function freeUnits(units: number, wanted: StayRange, occupied: StayRange[], nightStarts: Date[]): number {
  if (nightStarts.length === 0) return units;
  let min = units;
  for (let i = 0; i < nightStarts.length; i++) {
    const nightStart = nightStarts[i]!;
    const nightEnd = nightStarts[i + 1] ?? wanted.endAt;
    const taken = occupied.filter((o) => o.startAt < nightEnd && nightStart < o.endAt).length;
    min = Math.min(min, units - taken);
  }
  return min;
}
