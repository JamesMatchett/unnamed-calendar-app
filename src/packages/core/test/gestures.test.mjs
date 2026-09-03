import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PULL,
  overscrollPast,
  pullEdge,
  releaseAction,
  topRelease,
} from "../dist/gestures.js";

/** A day with one event: content SHORTER than the screen. */
const shortDay = (offsetY) => ({
  offsetY,
  layoutHeight: 800,
  contentHeight: 300,
});

/** A day with no events at all, which still has to be pullable. */
const emptyDay = (offsetY) => ({
  offsetY,
  layoutHeight: 800,
  contentHeight: 120,
});

/** A busy day that scrolls. */
const longDay = (offsetY) => ({
  offsetY,
  layoutHeight: 800,
  contentHeight: 2400,
});

test("overscroll is measured from the resting bottom, not the content", () => {
  // At rest, a short day is not being pulled, however much slack there is.
  assert.equal(overscrollPast(shortDay(0)), 0);
  assert.equal(overscrollPast(emptyDay(0)), 0);
  assert.equal(overscrollPast(longDay(0)), -1600);

  // Dragged 120 past the end, both read the same.
  assert.equal(overscrollPast(shortDay(120)), 120);
  assert.equal(overscrollPast(longDay(1720)), 120);
});

test("a day with no events can still be pulled to the next one", () => {
  assert.equal(pullEdge(emptyDay(0)), null);
  assert.equal(pullEdge(emptyDay(40)), "bottom");
  assert.equal(pullEdge(emptyDay(PULL.dayForward)), "bottom-day");
  assert.equal(
    releaseAction({ up: 0, down: PULL.dayForward }),
    "next-day",
  );
});

test("hints name the edge, and promise a day change only when one is due", () => {
  assert.equal(pullEdge(longDay(0)), null, "resting at the top");
  assert.equal(pullEdge(longDay(800)), null, "mid-scroll");

  assert.equal(pullEdge(longDay(-20)), "top");
  assert.equal(pullEdge(longDay(-PULL.dayBack)), "top-day");
  assert.equal(pullEdge(longDay(-PULL.dayBack + 1)), "top");

  assert.equal(pullEdge(longDay(1620)), "bottom");
  assert.equal(pullEdge(longDay(1600 + PULL.dayForward)), "bottom-day");
});

test("scrolling a long day does not look like a pull", () => {
  for (const y of [0, 400, 800, 1200, 1600]) {
    assert.equal(pullEdge(longDay(y)), null, `offset ${y}`);
    assert.equal(releaseAction({ up: 0, down: overscrollPast(longDay(y)) }), "none");
  }
});

test("a released drag changes day only if it went far enough", () => {
  assert.equal(releaseAction({ up: 0, down: 0 }), "none");
  assert.equal(releaseAction({ up: 0, down: PULL.dayForward - 1 }), "none");
  assert.equal(releaseAction({ up: 0, down: PULL.dayForward }), "next-day");
  assert.equal(releaseAction({ up: 0, down: 400 }), "next-day");

  assert.equal(releaseAction({ up: PULL.dayBack - 1, down: 0 }), "none");
  assert.equal(releaseAction({ up: PULL.dayBack, down: 0 }), "previous-day");
});

test("a drag that reached both ends goes forward, since that is where it ended", () => {
  assert.equal(
    releaseAction({ up: 300, down: 300 }),
    "next-day",
    "a flick through a long day ends at the bottom",
  );
});

test("at the top, distance separates refresh from a day back", () => {
  assert.equal(topRelease(0), "refresh");
  assert.equal(topRelease(90), "refresh", "the familiar short pull still refreshes");
  assert.equal(topRelease(PULL.dayBack - 1), "refresh");
  assert.equal(topRelease(PULL.dayBack), "previous-day");
  assert.equal(topRelease(400), "previous-day");
});

test("the day-back threshold sits clear of the system refresh threshold", () => {
  // iOS fires its refresh control at roughly 100pt. If dayBack were near that,
  // an ordinary refresh would sometimes jump a day instead.
  assert.ok(PULL.dayBack > 130, "dayBack must clear the refresh threshold");
  assert.ok(PULL.dayForward > PULL.reveal, "the hint must appear before the action");
});
