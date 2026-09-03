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

/**
 * "Today", "Tomorrow", "in 4 days" for a day heading.
 *
 * Counted in whole local days, not in elapsed hours: an event at 09:00 tomorrow
 * is "Tomorrow" even though it is 14 hours away, which is how people actually
 * read a date. Returns null for days that have already gone.
 */
export function formatCountdown(dayIso: string, now = new Date()): string | null {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = dayIso.split("-").map(Number);
  if (!y || !m || !d) return null;

  const days = Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 14) return "in a week";
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}
