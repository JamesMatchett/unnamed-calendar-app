/**
 * Timezone arithmetic. Architecture.md §5.5.
 *
 * The app stores an instant, a zone and the original wall-clock reading, and
 * these are the conversions between them. Kept apart from the rest so the two
 * genuinely fiddly functions live in one place with their own tests.
 */

import type { Instant } from "./time.js";

/** How far ahead of UTC `tz` is at a given instant, in milliseconds. */
function offsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/**
 * "2026-10-14T19:30" read as a clock on a wall in `tz`, converted to the instant
 * it names.
 *
 * Applied twice because the offset itself depends on the instant: a first guess
 * lands close enough that the second pass is correct, including on the day the
 * clocks change.
 */
export function zonedWallToUtc(wall: string, tz: string): Instant {
  const guess = new Date(`${wall.length === 10 ? `${wall}T00:00:00` : wall}Z`);
  let result = new Date(guess.getTime() - offsetMs(guess, tz));
  result = new Date(guess.getTime() - offsetMs(result, tz));
  return result.toISOString();
}

/** The UTC instant at which `date` (YYYY-MM-DD) begins in `tz`. */
export const localMidnightUtc = (date: string, tz: string): Instant =>
  zonedWallToUtc(`${date}T00:00:00`, tz);

/**
 * The UTC instants bounding a local calendar day.
 *
 * Deriving the end as "start plus 24 hours" is wrong twice a year: on a DST
 * boundary a local day is 23 or 25 hours long. Taking the start of the following
 * day instead is correct by construction.
 */
export function dayBoundsIn(
  date: string,
  tz: string,
): { dayStart: Instant; dayEnd: Instant } {
  const next = new Date(`${date}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);

  return {
    dayStart: localMidnightUtc(date, tz),
    dayEnd: localMidnightUtc(next.toISOString().slice(0, 10), tz),
  };
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds whole days to a YYYY-MM-DD date without touching times. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
