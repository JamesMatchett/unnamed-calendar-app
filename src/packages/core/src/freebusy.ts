/**
 * Finding a time two people are both free (§8.1, "find a time").
 *
 * The hard part of arranging a catch-up is not the messaging, it is that the
 * answer is an intersection nobody can hold in their head: my evenings minus
 * yours, minus the two things I have not told you about. So this computes it.
 *
 * Deliberately pure and zone-free: every input is an instant, and the caller
 * resolves "Tuesday evening in Lisbon" into a pair of instants before asking.
 * That keeps the timezone reasoning in one place (the zone helpers) rather than
 * duplicated inside the search, and makes every rule below testable without a
 * clock or a locale.
 */

import type { Instant } from "./time.js";

export interface Interval {
  readonly start: Instant;
  readonly end: Instant;
}

/**
 * A stretch of a day the search may offer, as instants: "Wednesday, 18:00 to
 * 22:00, in the calendar's zone" arrives here already resolved.
 */
export interface Window extends Interval {
  /** YYYY-MM-DD, carried through so a result can say which day it is. */
  readonly day: string;
}

export interface Slot extends Interval {
  readonly day: string;
}

const MINUTE = 60_000;

const ms = (i: Instant): number => new Date(i).getTime();
const iso = (n: number): Instant => new Date(n).toISOString();

/**
 * Merge overlapping or touching intervals into the fewest that cover the same
 * time.
 *
 * Two back-to-back events are one busy stretch, and a search that treats them
 * as two will happily offer the instant between them. Sorting first means one
 * pass is enough.
 */
export function mergeBusy(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((i) => ms(i.end) > ms(i.start))
    .sort((a, b) => ms(a.start) - ms(b.start));

  const out: { start: number; end: number }[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && ms(item.start) <= last.end) {
      last.end = Math.max(last.end, ms(item.end));
    } else {
      out.push({ start: ms(item.start), end: ms(item.end) });
    }
  }
  return out.map((i) => ({ start: iso(i.start), end: iso(i.end) }));
}

/** The parts of `window` left over once every busy stretch is removed. */
export function freeWithin(
  window: Interval,
  busy: readonly Interval[],
): Interval[] {
  const out: Interval[] = [];
  let cursor = ms(window.start);
  const end = ms(window.end);

  for (const b of mergeBusy(busy)) {
    const bs = ms(b.start);
    const be = ms(b.end);
    if (be <= cursor) continue;
    if (bs >= end) break;
    if (bs > cursor) out.push({ start: iso(cursor), end: iso(Math.min(bs, end)) });
    cursor = Math.max(cursor, be);
    if (cursor >= end) break;
  }

  if (cursor < end) out.push({ start: iso(cursor), end: iso(end) });
  return out;
}

export interface FindOptions {
  /** How long the catch-up needs to be, in minutes. */
  readonly durationMins: number;
  /**
   * How many to return. A page of forty options is not a list of suggestions,
   * it is the same problem again — so the caller asks for a handful.
   */
  readonly limit?: number;
  /**
   * At most this many per day, so one very free Saturday cannot crowd out the
   * rest of the week. A suggestion list that is five slots on one day answers
   * "when on Saturday", which was not the question.
   */
  readonly perDay?: number;
}

/**
 * The earliest times inside `windows` where nobody is busy.
 *
 * Slots are aligned to the start of each free stretch rather than to a grid of
 * half-hours: the useful answer to "when are we both free" is the moment the
 * gap opens, and offering 18:30 when 18:07 works is a worse answer that merely
 * looks tidier. One slot per free stretch, earliest first, capped per day.
 */
export function findMutualSlots(
  windows: readonly Window[],
  busy: readonly Interval[],
  { durationMins, limit = 6, perDay = 2 }: FindOptions,
): Slot[] {
  const merged = mergeBusy(busy);
  const need = durationMins * MINUTE;
  const out: Slot[] = [];
  const perDayCount = new Map<string, number>();

  for (const window of [...windows].sort((a, b) => ms(a.start) - ms(b.start))) {
    for (const gap of freeWithin(window, merged)) {
      if (ms(gap.end) - ms(gap.start) < need) continue;

      const taken = perDayCount.get(window.day) ?? 0;
      if (taken >= perDay) break;

      out.push({
        day: window.day,
        start: gap.start,
        end: iso(ms(gap.start) + need),
      });
      perDayCount.set(window.day, taken + 1);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

/**
 * Whether a free/busy answer is available at all.
 *
 * "none" is not a failure to be papered over with an empty list: an empty list
 * says "you are never both free", which is a different and wrong statement.
 * The caller has to distinguish them, so the rule lives here with the rest.
 */
export function canSeeFreeBusy(grants: "none" | "busy" | "full" | null): boolean {
  return grants === "busy" || grants === "full";
}
