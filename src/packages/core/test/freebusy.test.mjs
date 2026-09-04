import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canSeeFreeBusy,
  findMutualSlots,
  freeWithin,
  mergeBusy,
} from "../dist/freebusy.js";

const at = (day, hhmm) => `2026-10-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`;
const span = (day, from, to) => ({ start: at(day, from), end: at(day, to) });
const evening = (day) => ({ day: `2026-10-${String(day).padStart(2, "0")}`, ...span(day, "18:00", "22:00") });

const shown = (slots) => slots.map((s) => [s.day, s.start.slice(11, 16), s.end.slice(11, 16)]);

// --- merging ---------------------------------------------------------------

test("overlapping busy stretches become one", () => {
  assert.deepEqual(
    mergeBusy([span(12, "09:00", "11:00"), span(12, "10:00", "12:00")]).map((i) => [
      i.start.slice(11, 16),
      i.end.slice(11, 16),
    ]),
    [["09:00", "12:00"]],
  );
});

test("back-to-back busy stretches leave no gap between them", () => {
  // The bug this exists to prevent: two adjacent events treated separately
  // leave an instant between them that the search would happily offer.
  assert.equal(
    mergeBusy([span(12, "18:00", "19:00"), span(12, "19:00", "20:00")]).length,
    1,
  );
});

test("zero-length and reversed intervals are dropped rather than trusted", () => {
  assert.deepEqual(mergeBusy([span(12, "10:00", "10:00")]), []);
  assert.deepEqual(mergeBusy([span(12, "12:00", "11:00")]), []);
});

test("merging leaves the input alone", () => {
  const input = [span(12, "10:00", "12:00"), span(12, "09:00", "11:00")];
  const copy = JSON.parse(JSON.stringify(input));
  mergeBusy(input);
  assert.deepEqual(input, copy);
});

// --- free time within one window ------------------------------------------

test("busy in the middle splits the window in two", () => {
  assert.deepEqual(
    freeWithin(span(12, "18:00", "22:00"), [span(12, "19:00", "20:00")]).map((i) => [
      i.start.slice(11, 16),
      i.end.slice(11, 16),
    ]),
    [
      ["18:00", "19:00"],
      ["20:00", "22:00"],
    ],
  );
});

test("busy that covers the window leaves nothing", () => {
  assert.deepEqual(freeWithin(span(12, "18:00", "22:00"), [span(12, "17:00", "23:00")]), []);
});

test("busy outside the window does not clip it", () => {
  assert.deepEqual(
    freeWithin(span(12, "18:00", "22:00"), [span(12, "09:00", "10:00")]).map(
      (i) => [i.start.slice(11, 16), i.end.slice(11, 16)],
    ),
    [["18:00", "22:00"]],
  );
});

// --- finding a time both are free -----------------------------------------

test("the earliest gap long enough wins", () => {
  const slots = findMutualSlots(
    [evening(12), evening(13)],
    [
      span(12, "18:00", "21:30"), // mine: only 30 minutes left on the 12th
      span(13, "18:00", "19:00"), // theirs
    ],
    { durationMins: 120 },
  );

  assert.deepEqual(shown(slots), [["2026-10-13", "19:00", "21:00"]]);
});

test("a slot is offered when the gap opens, not on a tidy half hour", () => {
  const slots = findMutualSlots([evening(12)], [span(12, "18:00", "19:07")], {
    durationMins: 60,
  });
  assert.deepEqual(shown(slots), [["2026-10-12", "19:07", "20:07"]]);
});

test("a gap shorter than the catch-up is not offered", () => {
  const slots = findMutualSlots([evening(12)], [span(12, "19:00", "21:30")], {
    durationMins: 120,
  });
  assert.deepEqual(slots, []);
});

test("either person being busy rules the time out", () => {
  const mine = span(12, "18:00", "20:00");
  const theirs = span(12, "20:00", "22:00");
  assert.deepEqual(findMutualSlots([evening(12)], [mine, theirs], { durationMins: 60 }), []);
});

test("one very free day cannot crowd out the rest", () => {
  const slots = findMutualSlots(
    [evening(12), evening(13), evening(14)],
    [span(12, "19:00", "19:30"), span(12, "20:30", "20:45")],
    { durationMins: 60, perDay: 1, limit: 5 },
  );
  assert.deepEqual(
    slots.map((s) => s.day),
    ["2026-10-12", "2026-10-13", "2026-10-14"],
  );
});

test("the limit is respected and results stay in time order", () => {
  const slots = findMutualSlots(
    [evening(14), evening(12), evening(13)],
    [],
    { durationMins: 60, limit: 2 },
  );
  assert.deepEqual(
    slots.map((s) => s.day),
    ["2026-10-12", "2026-10-13"],
  );
});

test("no shared time is an empty list, and no permission is not", () => {
  // These must not be the same answer: one says "you are never both free",
  // the other says "you cannot see".
  assert.deepEqual(findMutualSlots([evening(12)], [span(12, "17:00", "23:00")], {
    durationMins: 60,
  }), []);
  assert.equal(canSeeFreeBusy(null), false);
  assert.equal(canSeeFreeBusy("none"), false);
  assert.equal(canSeeFreeBusy("busy"), true);
  assert.equal(canSeeFreeBusy("full"), true);
});
