/**
 * Deciding when to say "this is starting soon" (§5.7, §7.3).
 *
 * Pure: no expo-notifications, no database, no clock of its own. The caller
 * passes the events and the moment, and gets back exactly what should be handed
 * to the operating system.
 *
 * The reason this is worth a module rather than a loop at the call site is a
 * hard limit nobody discovers until it bites: iOS keeps at most 64 pending
 * local notifications per app, silently dropping the rest. An app with three
 * reminder offsets and thirty events would ask for ninety, get sixty-four, and
 * the ones lost would be an arbitrary subset — which in practice means the
 * reminder that goes missing is for the event furthest away, or the one you
 * cared about, with no way to tell which. So the cap is applied here,
 * deliberately, nearest first, where it can be reasoned about and tested.
 */

import type { ReminderOffset } from "./notifications.js";

export interface RemindableEvent {
  readonly eventId: string;
  readonly title: string;
  /** For the body: "in Lisbon 2027". */
  readonly calendarName: string | null;
  readonly startUtc: string;
  readonly precision: "datetime" | "date" | "tbc";
  readonly status: "active" | "cancelled";
}

export interface PlannedReminder {
  readonly eventId: string;
  readonly offset: ReminderOffset;
  /** When the notification should appear. */
  readonly fireAt: string;
  readonly title: string;
  readonly body: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * What an all-day event counts as starting at.
 *
 * Midnight is technically true and useless: a notification at 00:00 saying a
 * trip begins today arrives while you are asleep and is gone by morning. Nine
 * is when somebody would want to hear it, and it is what every calendar app
 * settled on for the same reason.
 */
const MORNING_HOUR = 9;

/**
 * iOS silently keeps only the first 64 pending local notifications. Sixty
 * leaves room for anything else the app schedules without going near the edge,
 * since the failure at the edge is invisible.
 */
export const REMINDER_LIMIT = 60;

export function plannedReminders(
  events: readonly RemindableEvent[],
  offsets: readonly ReminderOffset[],
  now: Date,
  limit: number = REMINDER_LIMIT,
): PlannedReminder[] {
  if (offsets.length === 0) return [];

  const from = now.getTime();
  const planned: PlannedReminder[] = [];
  // Two events can want a notification at the same instant, which is fine, but
  // one event must never be scheduled twice for the same moment: with an
  // all-day event, "when it starts" and "an hour before" collapse onto the same
  // time, and two identical notifications a second apart reads as a bug.
  const seen = new Set<string>();

  for (const event of events) {
    if (event.status !== "active") continue;
    // Nothing to count down to. A poll that has not landed has no start time,
    // and picking one of the candidates would be inventing a plan.
    if (event.precision === "tbc") continue;

    const start = Date.parse(event.startUtc);
    if (Number.isNaN(start)) continue;
    const allDay = event.precision === "date";

    for (const offset of offsets) {
      const fireAt = fireTime(start, offset, allDay);
      if (fireAt === null) continue;
      // Already gone. Firing on schedule would mean a notification arriving
      // the instant the app opens, about something that happened last week.
      if (fireAt <= from) continue;

      const key = `${event.eventId}@${fireAt}`;
      if (seen.has(key)) continue;
      seen.add(key);

      planned.push({
        eventId: event.eventId,
        offset,
        fireAt: new Date(fireAt).toISOString(),
        title: event.title,
        body: bodyFor(offset, allDay, event.calendarName),
      });
    }
  }

  // Nearest first, so that when the cap bites it takes the reminders furthest
  // away, which are the ones there is still time to reschedule on a later run.
  planned.sort((a, b) => (a.fireAt < b.fireAt ? -1 : a.fireAt > b.fireAt ? 1 : 0));
  return planned.slice(0, limit);
}

/**
 * All-day events are handled differently, and the difference is not cosmetic.
 *
 * "An hour before" a thing with no time means an hour before midnight, which is
 * a notification at eleven at night about tomorrow. That is not what anybody
 * means by it, so for all-day events that offset is dropped rather than honoured
 * literally; "when it starts" becomes the morning of, and "a day before"
 * becomes the morning before.
 */
function fireTime(start: number, offset: ReminderOffset, allDay: boolean): number | null {
  if (allDay) {
    const morning = start + MORNING_HOUR * HOUR;
    if (offset === "start") return morning;
    if (offset === "1d") return morning - DAY;
    return null;
  }
  if (offset === "start") return start;
  if (offset === "1h") return start - HOUR;
  return start - DAY;
}

function bodyFor(
  offset: ReminderOffset,
  allDay: boolean,
  calendarName: string | null,
): string {
  const when = allDay
    ? offset === "start"
      ? "Today"
      : "Tomorrow"
    : offset === "start"
      ? "Starting now"
      : offset === "1h"
        ? "In an hour"
        : "Tomorrow";
  return calendarName ? `${when}, in ${calendarName}` : when;
}

/**
 * Whether the schedule the operating system holds still matches what it should
 * be.
 *
 * Rescheduling is cheap but not free, and doing it on every write means
 * cancelling and re-adding sixty notifications because somebody typed a letter
 * into a title. Comparing first means the common case costs one string compare.
 */
export const reminderSignature = (planned: readonly PlannedReminder[]): string =>
  planned.map((p) => `${p.eventId}@${p.fireAt}`).join("|");
