/**
 * Presentation of the time triple from @uca/core.
 *
 * Everything renders in the EVENT's timezone, not the device's. A holiday in
 * Spain shows Spanish times even while you are packing in London — which is the
 * whole reason §5.5 stores tz alongside the instant.
 */

import type { EventTime } from "@uca/core";

const time = (t: EventTime): Intl.DateTimeFormatOptions => ({
  hour: "2-digit",
  minute: "2-digit",
  timeZone: t.tz,
  hour12: false,
});

export function formatEventTime(t: EventTime): string {
  if (t.precision === "tbc") return "Time TBC";
  if (t.precision === "date") return "All day";

  const start = new Date(t.startUtc).toLocaleTimeString("en-GB", time(t));
  if (!t.endUtc) return start;

  const end = new Date(t.endUtc).toLocaleTimeString("en-GB", time(t));
  return `${start} – ${end}`;
}

export function formatDayHeading(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  });
}

export function formatDayPill(iso: string, tz: string): { top: string; bottom: string } {
  const d = new Date(iso);
  return {
    top: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: tz }),
    bottom: d.toLocaleDateString("en-GB", { day: "numeric", timeZone: tz }),
  };
}

export function formatDateRange(start?: string, end?: string): string | null {
  if (!start || !end) return null;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const s = new Date(start).toLocaleDateString("en-GB", opts);
  const e = new Date(end).toLocaleDateString("en-GB", {
    ...opts,
    year: "numeric",
  });
  return `${s} – ${e}`;
}

/** '2026-09-15T19:00:00.000Z' -> '2026-09-15', in the given zone. */
export function dayKey(instant: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).formatToParts(new Date(instant));

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Just the clock, in the given zone — "18:30". */
export function formatClock(instant: string, tz: string): string {
  return new Date(instant).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });
}

/** "Mon 14 Oct" — compact enough for a day divider. */
export function formatDayShort(iso: string, tz: string): string {
  return new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  });
}
