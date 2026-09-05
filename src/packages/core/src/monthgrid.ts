/**
 * A month as a grid, and what picking a range on it means.
 *
 * Both halves are pure and live here rather than in the component, because the
 * grid maths is off-by-one country (which weekday a month starts on, how many
 * blanks to pad) and the range rules are the kind of thing that is obvious
 * until somebody taps the end date before the start date.
 */

import { addDays } from "./zones.js";

/**
 * The weeks of a month, Monday first, padded with nulls.
 *
 * Monday first because this is a British app and a week that starts on Sunday
 * puts the weekend in two different places.
 */
export function monthWeeks(month: string): (string | null)[][] {
  const first = `${month}-01`;
  // getUTCDay is Sunday-first; shift so Monday is 0.
  const offset = (new Date(`${first}T12:00:00.000Z`).getUTCDay() + 6) % 7;

  const days: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let cursor = first; cursor.startsWith(month); cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  while (days.length % 7 !== 0) days.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** Month as YYYY-MM, moved by whole months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1))
    .toISOString()
    .slice(0, 7);
}

export interface DateRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Where a day sits in the range, which is what decides how it is drawn.
 *
 * "only" is a one-day trip, where the same cell is both ends and so gets both
 * rounded edges rather than half a bar.
 */
export type RangePosition = "none" | "start" | "end" | "between" | "only";

export function positionIn(date: string, range: DateRange): RangePosition {
  if (range.start === range.end) return date === range.start ? "only" : "none";
  if (date === range.start) return "start";
  if (date === range.end) return "end";
  return date > range.start && date < range.end ? "between" : "none";
}

export type RangeField = "start" | "end";

/**
 * What a tap does.
 *
 * Exactly what it says: the day you touched becomes the end you were editing,
 * and nothing you did not touch moves. An earlier version was cleverer, sliding
 * the end along when the start moved and quietly turning a too-early end into a
 * new start. Both kept the range valid at all times, and both did it by
 * changing a date the person had not asked about, which is the more confusing
 * failure: a picker that moves things by itself cannot be trusted, whereas one
 * that lets you state something contradictory and then says so can.
 *
 * So a backwards range is reachable, and `isBackwards` is how the screen knows
 * to say so.
 *
 * Picking the start still moves on to the end, because that is the next thing
 * anybody does and it saves a tap on a second control.
 */
export function applyRangeTap(
  range: DateRange,
  editing: RangeField,
  tapped: string,
): { range: DateRange; editing: RangeField } {
  return editing === "start"
    ? { range: { start: tapped, end: range.end }, editing: "end" }
    : { range: { start: range.start, end: tapped }, editing: "end" };
}

/** A range that ends before it begins. Reachable, and always reported. */
export const isBackwards = (range: DateRange): boolean => range.end < range.start;

/** Whole days from one date to another, both in YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00.000Z`);
  const b = Date.parse(`${to}T12:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}
