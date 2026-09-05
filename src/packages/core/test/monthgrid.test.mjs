import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyRangeTap,
  dayAtPoint,
  daysBetween,
  isBackwards,
  monthWeeks,
  moveEndpoint,
  positionIn,
  shiftMonth,
} from "../dist/monthgrid.js";

// --- the grid ---------------------------------------------------------------

test("a month starts on the right weekday, Monday first", () => {
  // 1 September 2026 is a Tuesday, so one blank before it.
  const weeks = monthWeeks("2026-09");
  assert.deepEqual(weeks[0].slice(0, 3), [null, "2026-09-01", "2026-09-02"]);
});

test("a month that starts on a Monday has no leading blanks", () => {
  // 1 June 2026 is a Monday.
  assert.equal(monthWeeks("2026-06")[0][0], "2026-06-01");
});

test("every day of the month is present exactly once, and weeks are whole", () => {
  for (const month of ["2026-01", "2026-02", "2026-09", "2028-02"]) {
    const weeks = monthWeeks(month);
    const days = weeks.flat().filter(Boolean);
    assert.equal(new Set(days).size, days.length, `${month} has duplicates`);
    assert.ok(weeks.every((w) => w.length === 7), `${month} has a short week`);
    assert.ok(days.every((d) => d.startsWith(month)), `${month} leaked a day`);
  }
});

test("a leap February has 29 days", () => {
  assert.equal(monthWeeks("2028-02").flat().filter(Boolean).length, 29);
  assert.equal(monthWeeks("2026-02").flat().filter(Boolean).length, 28);
});

test("months shift across a year boundary", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-09", 4), "2027-01");
});

// --- where a day sits -------------------------------------------------------

test("the ends and the days between are told apart", () => {
  const range = { start: "2026-09-09", end: "2026-09-12" };
  assert.equal(positionIn("2026-09-09", range), "start");
  assert.equal(positionIn("2026-09-10", range), "between");
  assert.equal(positionIn("2026-09-12", range), "end");
  assert.equal(positionIn("2026-09-13", range), "none");
  assert.equal(positionIn("2026-09-08", range), "none");
});

test("a one day range is one cell, not half a bar", () => {
  const range = { start: "2026-09-09", end: "2026-09-09" };
  assert.equal(positionIn("2026-09-09", range), "only");
  assert.equal(positionIn("2026-09-10", range), "none");
});

// --- what a tap does --------------------------------------------------------

const range = { start: "2026-09-09", end: "2026-09-12" };

test("picking a start moves you on to the end", () => {
  const next = applyRangeTap(range, "start", "2026-09-14");
  assert.equal(next.editing, "end");
});

test("moving the start moves only the start", () => {
  const next = applyRangeTap(range, "start", "2026-09-10");
  assert.deepEqual(next.range, { start: "2026-09-10", end: "2026-09-12" });
});

test("picking an end after the start just sets the end", () => {
  const next = applyRangeTap(range, "end", "2026-09-20");
  assert.deepEqual(next.range, { start: "2026-09-09", end: "2026-09-20" });
});

test("an end before the start swaps the pair rather than refusing it", () => {
  const next = applyRangeTap(range, "end", "2026-09-05");
  assert.deepEqual(next.range, { start: "2026-09-05", end: "2026-09-09" });
});

test("a start after the end swaps too", () => {
  const next = applyRangeTap(range, "start", "2026-09-20");
  assert.deepEqual(next.range, { start: "2026-09-12", end: "2026-09-20" });
});

test("a range is never backwards, whatever the order of taps", () => {
  let state = { range, editing: "start" };
  for (const day of ["2026-09-20", "2026-09-02", "2026-09-30", "2026-09-01", "2026-10-15"]) {
    state = applyRangeTap(state.range, state.editing, day);
    assert.equal(isBackwards(state.range), false, `${state.range.start} to ${state.range.end}`);
  }
});

test("a swap hands the drag the end it is now holding", () => {
  // Dragging the end back past the start: the day under the finger has become
  // the START, and whatever is following the finger has to know.
  const next = moveEndpoint(range, "end", "2026-09-05");
  assert.deepEqual(next.range, { start: "2026-09-05", end: "2026-09-09" });
  assert.equal(next.field, "start");
});

test("a move that does not swap keeps hold of the same end", () => {
  const next = moveEndpoint(range, "end", "2026-09-15");
  assert.equal(next.field, "end");
  assert.deepEqual(next.range, { start: "2026-09-09", end: "2026-09-15" });
});

test("dragging an end onto the other end is a one day trip, not a swap", () => {
  const next = moveEndpoint(range, "end", "2026-09-09");
  assert.deepEqual(next.range, { start: "2026-09-09", end: "2026-09-09" });
  assert.equal(next.field, "end");
});

// --- which day is under a finger --------------------------------------------

const weeks = monthWeeks("2026-09");
const grid = { width: 350, rowHeight: 38, rowGap: 8, weeks };

test("a point lands on the day it is over", () => {
  // 1 September 2026 is a Tuesday: row 0, column 1.
  assert.equal(dayAtPoint({ ...grid, x: 75, y: 19 }), "2026-09-01");
  // Column 0 of row 0 is padding before the month starts.
  assert.equal(dayAtPoint({ ...grid, x: 25, y: 19 }), null);
});

test("rows are found past the gaps between them", () => {
  // Row 1 starts at 1 * (38 + 8) = 46, and holds the 7th to the 13th.
  assert.equal(dayAtPoint({ ...grid, x: 25, y: 65 }), "2026-09-07");
  assert.equal(dayAtPoint({ ...grid, x: 349, y: 65 }), "2026-09-13");
  // Row 2 starts at 92.
  assert.equal(dayAtPoint({ ...grid, x: 25, y: 100 }), "2026-09-14");
});

test("a point in the gap between two rows is nobody's day", () => {
  // 38 to 46 is the gap under the first row.
  assert.equal(dayAtPoint({ ...grid, x: 75, y: 41 }), null);
});

test("points outside the grid are nobody's day", () => {
  assert.equal(dayAtPoint({ ...grid, x: -1, y: 19 }), null);
  assert.equal(dayAtPoint({ ...grid, x: 350, y: 19 }), null);
  assert.equal(dayAtPoint({ ...grid, x: 75, y: -1 }), null);
  assert.equal(dayAtPoint({ ...grid, x: 75, y: 9999 }), null);
});

test("every day of the month can be reached by a finger", () => {
  const found = new Set();
  for (let row = 0; row < weeks.length; row++) {
    for (let col = 0; col < 7; col++) {
      const day = dayAtPoint({
        ...grid,
        x: (350 / 7) * col + 5,
        y: row * (38 + 8) + 19,
      });
      if (day) found.add(day);
    }
  }
  assert.equal(found.size, 30);
});

test("a range can span months and years", () => {
  const next = applyRangeTap({ start: "2026-12-28", end: "2026-12-29" }, "end", "2027-01-03");
  assert.deepEqual(next.range, { start: "2026-12-28", end: "2027-01-03" });
  assert.equal(daysBetween("2026-12-28", "2027-01-03"), 6);
});
