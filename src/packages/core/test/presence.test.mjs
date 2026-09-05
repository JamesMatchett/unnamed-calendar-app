import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyPresence, presenceTotal } from "../dist/index.js";

const DAY_START = "2026-10-14T00:00:00.000Z";
const DAY_END = "2026-10-15T00:00:00.000Z";

const p = (name, arrivesAt, departsAt) => ({
  userId: name,
  displayName: name,
  arrivesAt,
  departsAt,
});

const names = (list) => list.map((x) => x.displayName);

test("someone who arrived earlier and has not left is here", () => {
  const r = classifyPresence([p("Priya", "2026-10-12T10:00:00.000Z", null)], DAY_START, DAY_END);
  assert.deepEqual(names(r.here), ["Priya"]);
});

test("arrivals and departures on the day are separated out", () => {
  const r = classifyPresence(
    [
      p("Luke", "2026-10-14T15:40:00.000Z", null),
      p("Glenn", "2026-10-10T09:00:00.000Z", "2026-10-14T07:00:00.000Z"),
    ],
    DAY_START,
    DAY_END,
  );
  assert.deepEqual(names(r.arrivingToday), ["Luke"]);
  assert.deepEqual(names(r.leavingToday), ["Glenn"]);
  assert.equal(r.here.length, 0);
});

test("someone arriving and leaving the same day counts as both", () => {
  const r = classifyPresence(
    [p("Maya", "2026-10-14T08:00:00.000Z", "2026-10-14T22:00:00.000Z")],
    DAY_START,
    DAY_END,
  );
  assert.deepEqual(names(r.arrivingToday), ["Maya"]);
  assert.deepEqual(names(r.leavingToday), ["Maya"]);
});

test("people arriving later are still to come, and earlier leavers are gone", () => {
  const r = classifyPresence(
    [
      p("Tom", "2026-10-16T12:00:00.000Z", null),
      p("Sofia", "2026-10-09T12:00:00.000Z", "2026-10-13T12:00:00.000Z"),
    ],
    DAY_START,
    DAY_END,
  );
  assert.deepEqual(names(r.stillToCome), ["Tom"]);
  assert.deepEqual(names(r.alreadyGone), ["Sofia"]);
});

test("saying nothing is its own state, not an assumption of presence", () => {
  const r = classifyPresence([p("Dan", null, null)], DAY_START, DAY_END);
  assert.deepEqual(names(r.unknown), ["Dan"]);
  assert.equal(r.here.length, 0);
});

test("giving only a departure implies being here until then", () => {
  const r = classifyPresence([p("Ana", null, "2026-10-20T12:00:00.000Z")], DAY_START, DAY_END);
  assert.deepEqual(names(r.here), ["Ana"]);
});

test("the total counts each person once, despite same-day double listing", () => {
  const r = classifyPresence(
    [
      p("Maya", "2026-10-14T08:00:00.000Z", "2026-10-14T22:00:00.000Z"),
      p("Priya", "2026-10-12T10:00:00.000Z", null),
    ],
    DAY_START,
    DAY_END,
  );
  assert.equal(presenceTotal(r), 2);
});

test("a local day is bounded by local midnights, not a UTC offset", async () => {
  const { dayBoundsIn } = await import("../dist/index.js");
  // Lisbon is UTC+1 in October, so its day starts an hour before UTC midnight.
  const { dayStart, dayEnd } = dayBoundsIn("2026-10-14", "Europe/Lisbon");
  assert.equal(dayStart, "2026-10-13T23:00:00.000Z");
  assert.equal(dayEnd, "2026-10-14T23:00:00.000Z");
});

test("the day the clocks go back is 25 hours long", async () => {
  const { dayBoundsIn } = await import("../dist/index.js");
  // UK DST ends on 25 October 2026.
  const { dayStart, dayEnd } = dayBoundsIn("2026-10-25", "Europe/London");
  const hours = (new Date(dayEnd) - new Date(dayStart)) / 3_600_000;
  assert.equal(hours, 25);
});

test("a day in a zone behind UTC starts after UTC midnight", async () => {
  const { dayBoundsIn } = await import("../dist/index.js");
  const { dayStart } = dayBoundsIn("2026-07-04", "America/New_York");
  assert.equal(dayStart, "2026-07-04T04:00:00.000Z");
});

test("a group's icon is theirs when they agree and the calendar's when they don't", async () => {
  const { sharedTravelMode } = await import("../dist/index.js");
  const flying = [{ userId: "a", displayName: "A", travelMode: "train" },
                  { userId: "b", displayName: "B", travelMode: "train" }];
  const mixed = [{ userId: "a", displayName: "A", travelMode: "train" },
                 { userId: "b", displayName: "B", travelMode: "car" }];
  const unset = [{ userId: "a", displayName: "A", travelMode: null }];

  assert.equal(sharedTravelMode(flying, "plane"), "train");
  assert.equal(sharedTravelMode(mixed, "plane"), "plane");
  // Nobody has chosen, so everyone follows the calendar.
  assert.equal(sharedTravelMode(unset, "boat"), "boat");
});
