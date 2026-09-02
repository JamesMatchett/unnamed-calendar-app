/**
 * Column packing for a day timeline — the landscape view on mobile, and
 * eventually the day and week views on the web.
 *
 * Presentation logic rather than domain, but it lives here for two reasons: it
 * is pure, with no renderer and no React, so both clients can share one
 * implementation of a fiddly algorithm; and this is where the test harness is.
 *
 * The rule is the familiar one from desktop calendars: events that overlap in
 * time share the width of their cluster, each taking one column.
 */

export interface LaidOutEvent<T> {
  readonly item: T;
  /** Minutes from midnight, in the calendar's timezone. */
  readonly startMin: number;
  readonly endMin: number;
  /** 0..1 fractions of the available width. */
  readonly left: number;
  readonly width: number;
}

export interface TimedInput<T> {
  readonly item: T;
  readonly startMin: number;
  readonly endMin: number;
}

/** Events shorter than this are drawn at this height so they stay tappable. */
export const MIN_EVENT_MINUTES = 30;

export function layoutDay<T>(input: readonly TimedInput<T>[]): LaidOutEvent<T>[] {
  const events = [...input]
    .map((e) => ({
      ...e,
      endMin: Math.max(e.endMin, e.startMin + MIN_EVENT_MINUTES),
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: LaidOutEvent<T>[] = [];

  // A cluster is a run of events connected by overlap. Width is shared within a
  // cluster, so two events at opposite ends of the day are both full width even
  // though a third event overlaps neither.
  let cluster: typeof events = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;

    // Greedy column assignment: reuse the first column whose last event has
    // finished.
    const columnEnds: number[] = [];
    const columnOf = new Map<number, number>();

    cluster.forEach((e, i) => {
      let col = columnEnds.findIndex((end) => end <= e.startMin);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(e.endMin);
      } else {
        columnEnds[col] = e.endMin;
      }
      columnOf.set(i, col);
    });

    const columns = columnEnds.length;
    cluster.forEach((e, i) => {
      const col = columnOf.get(i) ?? 0;
      out.push({
        item: e.item,
        startMin: e.startMin,
        endMin: e.endMin,
        left: col / columns,
        width: 1 / columns,
      });
    });

    cluster = [];
    clusterEnd = -1;
  };

  for (const e of events) {
    if (cluster.length > 0 && e.startMin >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  flush();

  return out;
}

/** Minutes from midnight for an instant, in the given timezone. */
export function minutesInDay(instant: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(new Date(instant));

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Midnight can format as 24 rather than 00 in some locales.
  return (get("hour") % 24) * 60 + get("minute");
}
