import assert from "node:assert/strict";
import { test } from "node:test";

import {
  groupByTravelMode,
  sharedTravelMode,
  travelModeFor,
} from "../dist/presence.js";

const at = (hhmm) => `2026-10-18T${hhmm}:00.000Z`;

const person = (displayName, departsAt, travelMode = null) => ({
  userId: displayName.toLowerCase(),
  displayName,
  departsAt,
  travelMode,
});

test("one group per mode of transport", () => {
  const groups = groupByTravelMode(
    [
      person("Priya", at("19:40"), "plane"),
      person("Luke", at("14:00"), "car"),
      person("Glenn", at("14:30"), "car"),
    ],
    "plane",
    "departsAt",
  );

  assert.deepEqual(
    groups.map((g) => [g.mode, g.people.map((p) => p.displayName)]),
    [
      ["car", ["Luke", "Glenn"]],
      ["plane", ["Priya"]],
    ],
  );
});

test("groups are ordered by their earliest leaver, not by mode", () => {
  const groups = groupByTravelMode(
    [
      person("Priya", at("09:00"), "plane"),
      person("Luke", at("14:00"), "car"),
      person("Sofia", at("11:00"), "train"),
    ],
    "plane",
    "departsAt",
  );

  assert.deepEqual(groups.map((g) => g.mode), ["plane", "train", "car"]);
  assert.deepEqual(groups.map((g) => g.earliest), [at("09:00"), at("11:00"), at("14:00")]);
});

test("people inside a group are ordered by their own time", () => {
  const [car] = groupByTravelMode(
    [
      person("Glenn", at("16:00"), "car"),
      person("Luke", at("14:00"), "car"),
      person("Sofia", at("15:00"), "car"),
    ],
    "plane",
    "departsAt",
  );

  assert.deepEqual(car.people.map((p) => p.displayName), ["Luke", "Sofia", "Glenn"]);
  assert.equal(car.earliest, at("14:00"));
});

test("nobody who has not chosen is stranded: they follow the calendar", () => {
  const groups = groupByTravelMode(
    [person("Priya", at("10:00")), person("Luke", at("12:00"), "car")],
    "train",
    "departsAt",
  );

  assert.deepEqual(groups.map((g) => g.mode), ["train", "car"]);
  assert.deepEqual(groups[0].people.map((p) => p.displayName), ["Priya"]);
});

test("a change of the calendar's mode moves everyone who never chose", () => {
  const people = [person("Priya", at("10:00")), person("Luke", at("12:00"), "car")];
  assert.equal(groupByTravelMode(people, "plane", "departsAt")[0].mode, "plane");
  assert.equal(groupByTravelMode(people, "boat", "departsAt")[0].mode, "boat");
});

test("groups with no stated time sort last, never first", () => {
  const groups = groupByTravelMode(
    [
      person("Sofia", null, "walk"),
      person("Luke", at("14:00"), "car"),
    ],
    "plane",
    "departsAt",
  );

  assert.deepEqual(groups.map((g) => g.mode), ["car", "walk"]);
  assert.equal(groups[1].earliest, null);
});

test("inside a group, a person with no time also sorts last", () => {
  const [car] = groupByTravelMode(
    [person("Sofia", null, "car"), person("Luke", at("14:00"), "car")],
    "plane",
    "departsAt",
  );

  assert.deepEqual(car.people.map((p) => p.displayName), ["Luke", "Sofia"]);
});

test("it does not mutate what it was given", () => {
  const people = [
    person("Glenn", at("16:00"), "car"),
    person("Luke", at("14:00"), "car"),
  ];
  const before = people.map((p) => p.displayName);
  groupByTravelMode(people, "plane", "departsAt");
  assert.deepEqual(people.map((p) => p.displayName), before);
});

test("arrivals group the same way", () => {
  const groups = groupByTravelMode(
    [
      { userId: "p", displayName: "Priya", arrivesAt: at("16:40"), travelMode: "plane" },
      { userId: "l", displayName: "Luke", arrivesAt: at("11:00"), travelMode: "train" },
    ],
    "plane",
    "arrivesAt",
  );

  assert.deepEqual(groups.map((g) => g.mode), ["train", "plane"]);
});

test("no movements means no rows", () => {
  assert.deepEqual(groupByTravelMode([], "plane", "departsAt"), []);
});

// --- Different ways in and out -------------------------------------------

test("a stated outbound mode is used for departures only", () => {
  const james = {
    userId: "james",
    displayName: "James",
    arrivesAt: at("09:00"),
    departsAt: at("18:00"),
    travelMode: "plane",
    travelModeOut: "car",
  };

  assert.equal(travelModeFor(james, "in", "train"), "plane");
  assert.equal(travelModeFor(james, "out", "train"), "car");

  assert.deepEqual(
    groupByTravelMode([james], "train", "arrivesAt").map((g) => g.mode),
    ["plane"],
  );
  assert.deepEqual(
    groupByTravelMode([james], "train", "departsAt").map((g) => g.mode),
    ["car"],
  );
});

test("no outbound mode means leaving the way you came", () => {
  const p = { userId: "p", displayName: "P", travelMode: "boat" };
  assert.equal(travelModeFor(p, "out", "plane"), "boat");
});

test("neither mode stated falls back to the calendar, both ways", () => {
  const p = { userId: "p", displayName: "P" };
  assert.equal(travelModeFor(p, "in", "train"), "train");
  assert.equal(travelModeFor(p, "out", "train"), "train");
});

test("people who came together can leave separately", () => {
  const flown = (name, out) => ({
    userId: name.toLowerCase(),
    displayName: name,
    arrivesAt: at("09:00"),
    departsAt: at(out === "car" ? "14:00" : "19:40"),
    travelMode: "plane",
    travelModeOut: out,
  });

  const people = [flown("Priya", "plane"), flown("Luke", "car")];

  assert.deepEqual(
    groupByTravelMode(people, "plane", "arrivesAt").map((g) => g.mode),
    ["plane"],
  );
  assert.deepEqual(
    groupByTravelMode(people, "plane", "departsAt").map((g) => [
      g.mode,
      g.people.map((x) => x.displayName),
    ]),
    [
      ["car", ["Luke"]],
      ["plane", ["Priya"]],
    ],
  );
});

test("a shared icon respects the direction asked about", () => {
  const people = [
    { userId: "a", displayName: "A", travelMode: "plane", travelModeOut: "car" },
    { userId: "b", displayName: "B", travelMode: "plane", travelModeOut: "car" },
  ];
  assert.equal(sharedTravelMode(people, "train", "in"), "plane");
  assert.equal(sharedTravelMode(people, "train", "out"), "car");
  // Disagreement falls back rather than picking a winner.
  assert.equal(
    sharedTravelMode(
      [people[0], { userId: "c", displayName: "C", travelMode: "boat" }],
      "train",
      "in",
    ),
    "train",
  );
});
