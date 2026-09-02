// The parser silently guesses, so it is tested exhaustively. A wrong guess only
// costs a tap to correct, but a parser that is wrong often stops being used.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEventText } from "../dist/index.js";

const TZ = "Europe/London";
// A Monday, so weekday arithmetic is checkable by hand.
const NOW = new Date("2026-10-12T09:00:00.000Z");

const parse = (text) => parseEventText(text, TZ, NOW);

test("the motivating example", () => {
  const r = parse("Drinks at The Crown Thursday 8pm");
  assert.equal(r.title, "Drinks");
  assert.equal(r.location, "The Crown");
  assert.equal(r.time, "20:00");
  assert.equal(r.date, "2026-10-15"); // the coming Thursday
});

test("a bare title stays a bare title", () => {
  const r = parse("Beach day");
  assert.deepEqual(
    { title: r.title, date: r.date, time: r.time, location: r.location },
    { title: "Beach day", date: null, time: null, location: null },
  );
});

test("times in several shapes", () => {
  assert.equal(parse("Dinner 8pm").time, "20:00");
  assert.equal(parse("Dinner 8:30pm").time, "20:30");
  assert.equal(parse("Dinner at 19:45").time, "19:45");
  assert.equal(parse("Dinner 12am").time, "00:00");
  assert.equal(parse("Dinner 12pm").time, "12:00");
});

test("bare numbers are not times", () => {
  // The classic false positive: these are titles, not 5am and 54:00.
  assert.equal(parse("5 a side").time, null);
  assert.equal(parse("Studio 54").time, null);
  assert.equal(parse("5 a side").title, "5 a side");
});

test("today and tomorrow", () => {
  assert.equal(parse("Pub today").date, "2026-10-12");
  assert.equal(parse("Pub tomorrow").date, "2026-10-13");
});

test("tonight sets both the day and an evening hour", () => {
  const r = parse("Pub tonight");
  assert.equal(r.date, "2026-10-12");
  assert.equal(r.time, "19:00");
});

test("a bare weekday means the next one, never today", () => {
  // Said on a Monday, "Monday" means next week, not this morning.
  assert.equal(parse("Football Monday").date, "2026-10-19");
  assert.equal(parse("Football Tuesday").date, "2026-10-13");
  assert.equal(parse("Football next Tuesday").date, "2026-10-20");
});

test("explicit dates, in either order", () => {
  assert.equal(parse("Gig 14 Nov").date, "2026-11-14");
  assert.equal(parse("Gig Nov 14").date, "2026-11-14");
  assert.equal(parse("Gig 14th November").date, "2026-11-14");
});

test("a date already past rolls to next year", () => {
  // Nobody schedules backwards.
  assert.equal(parse("Party 3 Jan").date, "2027-01-03");
});

test("location stops before the day", () => {
  const r = parse("Dinner at Time Out Market Friday");
  assert.equal(r.location, "Time Out Market");
  assert.equal(r.date, "2026-10-16");
});

test("@ works as well as at", () => {
  const r = parse("Jockstrap @ EartH 7:30pm");
  assert.equal(r.location, "EartH");
  assert.equal(r.time, "19:30");
  assert.equal(r.title, "Jockstrap");
});

test("'at' introducing a time is not a location", () => {
  const r = parse("Standup at 9:30");
  assert.equal(r.location, null);
  assert.equal(r.time, "09:30");
  assert.equal(r.title, "Standup");
});

test("titles come back tidy, not full of holes", () => {
  assert.equal(parse("drinks at The Crown Thursday 8pm").title, "Drinks");
  assert.equal(parse("Tram 28 and the viewpoints").title, "Tram 28 and the viewpoints");
});
