// The column-packing rules for a day timeline. Easy to get subtly wrong in ways
// that only show up as overlapping boxes on one unlucky day.

import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutDay, minutesInDay, MIN_EVENT_MINUTES } from "../dist/index.js";

const ev = (name, startMin, endMin) => ({ item: name, startMin, endMin });
const byName = (laid, name) => laid.find((l) => l.item === name);

test("a lone event takes the full width", () => {
  const [only] = layoutDay([ev("a", 600, 660)]);
  assert.equal(only.left, 0);
  assert.equal(only.width, 1);
});

test("two overlapping events split the width", () => {
  const laid = layoutDay([ev("a", 600, 720), ev("b", 660, 780)]);
  assert.equal(byName(laid, "a").width, 0.5);
  assert.equal(byName(laid, "b").width, 0.5);
  assert.notEqual(byName(laid, "a").left, byName(laid, "b").left);
});

test("events that do not overlap are both full width", () => {
  const laid = layoutDay([ev("morning", 540, 600), ev("evening", 1140, 1200)]);
  assert.equal(byName(laid, "morning").width, 1);
  assert.equal(byName(laid, "evening").width, 1);
});

test("a column is reused once its previous event has finished", () => {
  // c overlaps a but starts after b ends, so it can take b's column and the
  // cluster stays two wide rather than growing to three.
  const laid = layoutDay([ev("a", 600, 900), ev("b", 600, 700), ev("c", 720, 800)]);
  assert.equal(byName(laid, "a").width, 0.5);
  assert.equal(byName(laid, "c").width, 0.5);
  assert.equal(byName(laid, "b").left, byName(laid, "c").left);
});

test("three mutually overlapping events each take a third", () => {
  const laid = layoutDay([ev("a", 600, 700), ev("b", 610, 700), ev("c", 620, 700)]);
  for (const n of ["a", "b", "c"]) {
    assert.ok(Math.abs(byName(laid, n).width - 1 / 3) < 1e-9);
  }
  assert.equal(new Set(laid.map((l) => l.left)).size, 3);
});

test("clusters are independent, so one busy hour does not squeeze the rest", () => {
  const laid = layoutDay([
    ev("a", 600, 700),
    ev("b", 610, 700),
    ev("later", 1200, 1260),
  ]);
  assert.equal(byName(laid, "later").width, 1);
});

test("a very short event is given a minimum height", () => {
  const [only] = layoutDay([ev("quick", 600, 605)]);
  assert.equal(only.endMin - only.startMin, MIN_EVENT_MINUTES);
});

test("minutes are computed in the event's timezone, not the runtime's", () => {
  const instant = "2026-07-15T18:30:00.000Z";
  assert.equal(minutesInDay(instant, "UTC"), 18 * 60 + 30);
  // London is UTC+1 in July.
  assert.equal(minutesInDay(instant, "Europe/London"), 19 * 60 + 30);
  // Lisbon is UTC+1 in July too; New York is UTC-4.
  assert.equal(minutesInDay(instant, "America/New_York"), 14 * 60 + 30);
});

test("midnight is zero, not 1440", () => {
  assert.equal(minutesInDay("2026-07-15T00:00:00.000Z", "UTC"), 0);
});
