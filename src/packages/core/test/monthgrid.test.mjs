import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyRangeTap,
  daysBetween,
  isBackwards,
  monthWeeks,
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
  const next = applyRangeTap(range, "start", "2026-09-20");
  assert.deepEqual(next.range, { start: "2026-09-20", end: "2026-09-12" });
});

test("picking an end after the start just sets the end", () => {
  const next = applyRangeTap(range, "end", "2026-09-20");
  assert.deepEqual(next.range, { start: "2026-09-09", end: "2026-09-20" });
});

test("an end before the start is allowed, and reported", () => {
  // Not silently corrected: the screen says so and refuses to save, which is
  // honest about what was picked rather than moving a date nobody touched.
  const next = applyRangeTap(range, "end", "2026-09-05");
  assert.deepEqual(next.range, { start: "2026-09-09", end: "2026-09-05" });
  assert.equal(isBackwards(next.range), true);
});

test("a start after the end is reported the same way", () => {
  const next = applyRangeTap(range, "start", "2026-09-30");
  assert.equal(isBackwards(next.range), true);
});

test("a sound range is not reported, including a single day", () => {
  assert.equal(isBackwards(range), false);
  assert.equal(isBackwards({ start: "2026-09-09", end: "2026-09-09" }), false);
});

test("fixing a backwards range clears the warning", () => {
  const broken = applyRangeTap(range, "end", "2026-09-01").range;
  assert.equal(isBackwards(broken), true);
  const fixed = applyRangeTap(broken, "end", "2026-09-11").range;
  assert.equal(isBackwards(fixed), false);
});

test("a range can span months and years", () => {
  const next = applyRangeTap({ start: "2026-12-28", end: "2026-12-29" }, "end", "2027-01-03");
  assert.deepEqual(next.range, { start: "2026-12-28", end: "2027-01-03" });
  assert.equal(daysBetween("2026-12-28", "2027-01-03"), 6);
});
