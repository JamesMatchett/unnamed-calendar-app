import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEventText } from "../dist/parse.js";

const TZ = "Europe/Lisbon";
// A Thursday, so "Wednesday" resolves forwards to the 9th.
const NOW = new Date("2026-09-03T12:00:00.000Z");

const parse = (text) => parseEventText(text, TZ, NOW);

test('"all day" sets the precision and leaves the title clean', () => {
  const r = parse("Beach club trip on Wednesday all day");
  assert.equal(r.precision, "date");
  assert.equal(r.title, "Beach club trip");
  assert.equal(r.date, "2026-09-09");
  assert.equal(r.time, null);
});

test("all-day is recognised however it is written", () => {
  for (const text of [
    "Museum all day",
    "Museum all-day",
    "Museum allday",
    "Museum ALL DAY",
    "Museum for all day",
  ]) {
    assert.equal(parse(text).precision, "date", text);
    assert.equal(parse(text).title, "Museum", text);
  }
});

test('"TBC" and its cousins set precision to tbc', () => {
  for (const text of ["Boat trip TBC", "Boat trip tba", "Boat trip TBD", "Boat trip time tbc"]) {
    const r = parse(text);
    assert.equal(r.precision, "tbc", text);
    assert.equal(r.title, "Boat trip", text);
    assert.equal(r.time, null, text);
  }
});

test("TBC is not mistaken for a location", () => {
  // The location matcher looks for "at X"; "at the villa, time TBC" must keep
  // the villa and not swallow the TBC into it.
  const r = parse("Dinner at the villa, time TBC");
  assert.equal(r.precision, "tbc");
  assert.equal(r.location, "the villa");
});

test("a stated time still means datetime", () => {
  const r = parse("Drinks at The Crown Thursday 8pm");
  assert.equal(r.precision, "datetime");
  assert.equal(r.time, "20:00");
});

test("saying nothing about timing leaves precision unstated", () => {
  // null, NOT "datetime": the screen must be able to tell "they said nothing"
  // from "they said a time", so a parse never overrides a hand-made choice.
  const r = parse("Beach club trip");
  assert.equal(r.precision, null);
  assert.equal(r.time, null);
});

test("all day beats a stray number that is not a time", () => {
  const r = parse("Table 4 all day");
  assert.equal(r.precision, "date");
  assert.equal(r.title, "Table 4");
});

test("the words never survive into the title", () => {
  for (const [text, title] of [
    ["Beach club trip on Wednesday all day", "Beach club trip"],
    ["Wednesday all day beach club", "Beach club"],
    ["Boat trip TBC", "Boat trip"],
    ["Hike Saturday, time TBC", "Hike"],
  ]) {
    assert.equal(parse(text).title, title, text);
  }
});

test("a word merely containing the letters is left alone", () => {
  // "Tball", "hallday" and friends must not trip the word-boundary anchors.
  assert.equal(parse("Tball practice").precision, null);
  assert.equal(parse("Hall day out").precision, null);
});
