/**
 * Pull gestures on a day list, as arithmetic.
 *
 * This is UI behaviour rather than a domain rule, and it lives here for one
 * reason: it is the part of the interaction that can be WRONG, and core is where
 * things that can be wrong get tested. The screen keeps the pixels and the
 * animation; the decision of what a pull meant is here, where node can run it.
 *
 * The model is deliberately release-based. A gesture that fires part-way
 * through, while the finger is still moving, cannot be aimed: you find out what
 * you did after it has happened. Deciding on release means the hint can promise
 * something ("Release for Sat 5") and then keep the promise.
 */

/** What the scroll view reports, reduced to what the decision needs. */
export interface PullMetrics {
  /** contentOffset.y — negative above the top. */
  readonly offsetY: number;
  /** layoutMeasurement.height — the visible frame. */
  readonly layoutHeight: number;
  /** contentSize.height — the content, which may be shorter than the frame. */
  readonly contentHeight: number;
}

export interface PullThresholds {
  /** How far into a pull the hint appears. */
  readonly reveal: number;
  /** Downward pull past this means "a day back" rather than "refresh". */
  readonly dayBack: number;
  /** Upward pull past this means "a day forward". */
  readonly dayForward: number;
}

export const PULL: PullThresholds = {
  reveal: 16,
  // Comfortably past the system refresh threshold, so the short pull people
  // already know still refreshes.
  dayBack: 170,
  // Nothing competes with this direction, so it can be a shorter, easier pull.
  dayForward: 90,
};

/**
 * How far the view is dragged past its resting bottom.
 *
 * Measured against the RESTING bottom, not the content height: a day with one
 * event is shorter than the screen, and measuring the other way would read that
 * slack as a pull and change day on the first flick.
 */
export function overscrollPast(m: PullMetrics): number {
  const bottom = Math.max(0, m.contentHeight - m.layoutHeight);
  return m.offsetY - bottom;
}

export type PullEdge = "top" | "top-day" | "bottom" | "bottom-day" | null;

/**
 * Which hint to show mid-gesture. The "-day" variants are the ones where
 * letting go now would change day, so the hint can say "release" rather than
 * "keep pulling".
 */
export function pullEdge(m: PullMetrics, t: PullThresholds = PULL): PullEdge {
  if (m.offsetY < -t.reveal) {
    return m.offsetY <= -t.dayBack ? "top-day" : "top";
  }

  const past = overscrollPast(m);
  if (past > t.reveal) return past >= t.dayForward ? "bottom-day" : "bottom";

  return null;
}

/** The deepest the drag reached in each direction, both positive numbers. */
export interface PullDepth {
  readonly up: number;
  readonly down: number;
}

export type PullAction = "previous-day" | "next-day" | "refresh" | "none";

/**
 * What a released drag meant.
 *
 * Forward wins a tie because a drag that reached both ends is a flick through a
 * long day, and the last thing touched is the bottom.
 */
export function releaseAction(
  depth: PullDepth,
  t: PullThresholds = PULL,
): PullAction {
  if (depth.down >= t.dayForward) return "next-day";
  if (depth.up >= t.dayBack) return "previous-day";
  return "none";
}

/**
 * The top edge alone, where refresh and "a day back" share a direction and only
 * the distance separates them. Called when the system refresh control fires,
 * which is why "none" is not an option: the pull already passed that threshold.
 */
export function topRelease(up: number, t: PullThresholds = PULL): PullAction {
  return up >= t.dayBack ? "previous-day" : "refresh";
}
