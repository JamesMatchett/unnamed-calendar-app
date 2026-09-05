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
 * Move one end of the range to a day.
 *
 * If that would put the end before the start, the two swap. Somebody who sets
 * an end earlier than the start has told you both days they care about and got
 * the order round the wrong way, which is a thing to fix silently rather than
 * an error to explain: the pair is simply held in order. The field comes back
 * too, because after a swap the day just touched is the OTHER end, and anything
 * following a finger needs to know that.
 */
export function moveEndpoint(
  range: DateRange,
  field: RangeField,
  date: string,
): { range: DateRange; field: RangeField } {
  const moved =
    field === "start"
      ? { start: date, end: range.end }
      : { start: range.start, end: date };

  if (moved.end < moved.start) {
    return {
      range: { start: moved.end, end: moved.start },
      field: field === "start" ? "end" : "start",
    };
  }

  return { range: moved, field };
}

/**
 * What a tap does.
 *
 * The day you touched becomes the end you were editing, swapping if that would
 * invert the range, and then the highlight moves on to the end: picking a start
 * is nearly always followed by picking an end, and making somebody tap a second
 * control in between is the difference between two taps and four.
 */
export function applyRangeTap(
  range: DateRange,
  editing: RangeField,
  tapped: string,
): { range: DateRange; editing: RangeField } {
  return { range: moveEndpoint(range, editing, tapped).range, editing: "end" };
}

/** A range that ends before it begins. Never reachable through the picker. */
export const isBackwards = (range: DateRange): boolean => range.end < range.start;

/**
 * Which day is under a point, for dragging an end across the grid.
 *
 * The arithmetic rather than a measurement per cell: forty-two views each
 * reporting their own frame is forty-two round trips to the native side on
 * every layout, when the grid is a plain seven-column table whose geometry is
 * already known. Points in the gaps between rows, or outside the grid, are
 * nobody's day and come back null rather than snapping to a neighbour.
 */
export function dayAtPoint({
  x,
  y,
  width,
  rowHeight,
  rowGap,
  weeks,
}: {
  x: number;
  y: number;
  /** The grid's full width; columns are an equal share of it. */
  width: number;
  rowHeight: number;
  rowGap: number;
  weeks: readonly (readonly (string | null)[])[];
}): string | null {
  if (x < 0 || x >= width || y < 0) return null;

  const row = Math.floor(y / (rowHeight + rowGap));
  if (row >= weeks.length) return null;
  // Inside the gap below a row rather than on the row itself.
  if (y - row * (rowHeight + rowGap) >= rowHeight) return null;

  const column = Math.min(6, Math.floor((x / width) * 7));
  return weeks[row]?.[column] ?? null;
}

/** Whole days from one date to another, both in YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00.000Z`);
  const b = Date.parse(`${to}T12:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}
