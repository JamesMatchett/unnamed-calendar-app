import assert from "node:assert/strict";
import { test } from "node:test";

import { nextTravelSelection } from "../dist/presence.js";

const taps = (...modes) =>
  modes.reduce((state, mode) => nextTravelSelection(state, mode), {
    arrival: null,
    departure: null,
  });

test("one tap sets the way in and leaves the way out open", () => {
  assert.deepEqual(taps("plane"), { arrival: "plane", departure: null });
});

test("tapping the same icon twice means the same both ways", () => {
  assert.deepEqual(taps("plane", "plane"), { arrival: "plane", departure: "plane" });
});

test("two different icons mean there one way, back another", () => {
  assert.deepEqual(taps("plane", "car"), { arrival: "plane", departure: "car" });
});

test("a tap after both are answered starts a fresh pair", () => {
  assert.deepEqual(taps("plane", "car", "train"), {
    arrival: "train",
    departure: null,
  });
  assert.deepEqual(taps("plane", "car", "train", "train"), {
    arrival: "train",
    departure: "train",
  });
});

test("the way out is never set without a way in", () => {
  const state = nextTravelSelection({ arrival: null, departure: null }, "boat");
  assert.equal(state.departure, null);
  assert.equal(state.arrival, "boat");
});
