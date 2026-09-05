import * as Calendar from "expo-calendar/legacy";
import { Platform } from "react-native";

import type { DeviceEvent, ExportAction, ExportableEvent } from "@calder/core";

/**
 * The phone's own calendar (§5.7).
 *
 * Everything that knows expo-calendar exists lives here, so the screens above
 * deal in plain objects and the planning rules in @calder/core stay testable
 * without a device.
 *
 * Two things about the import worth knowing before changing it.
 *
 * It is `expo-calendar/legacy`, deliberately. SDK 57 ships a second, newer API
 * as the package's main entry, and that one throws "not available in Expo Go"
 * the moment it is touched, because Expo Go's binary does not carry its native
 * side. The legacy API is the one Expo Go has, so it is the one an alpha tester
 * can actually run. When this app moves to its own build, the newer API becomes
 * an option, not before.
 *
 * And every function here returns rather than throws. A person who has said no
 * to the calendar permission has not hit an error, they have made a choice, and
 * a screen that shows a red failure for it is arguing with them.
 */

export interface DeviceCalendar {
  readonly id: string;
  readonly title: string;
  /** The account it came from: "iCloud", a Google address, "Local". */
  readonly account: string;
  readonly colour: string;
  /** Whether we are allowed to write to it. Subscribed calendars are read-only. */
  readonly writable: boolean;
  readonly primary: boolean;
}

/** A well-known account we could sync to, whether or not this phone has one. */
export interface DeviceAccount {
  readonly name: string;
  /** How many calendars on this phone belong to it. Zero means not set up. */
  readonly calendars: number;
}

export type Permission = "granted" | "denied" | "unavailable";

/**
 * Ask, once, for access to the calendar.
 *
 * `canAskAgain` is false once the person has been asked and said no, and iOS
 * will never show the sheet again: the only route back is Settings. That is
 * reported as "denied" rather than retried, so the screen can say where to go
 * instead of silently doing nothing on every tap.
 */
export async function ensurePermission(): Promise<Permission> {
  if (Platform.OS === "web") return "unavailable";
  try {
    const existing = await Calendar.getCalendarPermissionsAsync();
    if (existing.granted) return "granted";
    const asked = await Calendar.requestCalendarPermissionsAsync();
    return asked.granted ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

/**
 * What was already decided, without asking anything.
 *
 * Separate from ensurePermission because a background sync must never make a
 * permission sheet appear. A dialog with no visible cause, on whatever screen
 * somebody happened to be on, is the worst way to ask for anything.
 */
export async function currentPermission(): Promise<Permission> {
  if (Platform.OS === "web") return "unavailable";
  try {
    return (await Calendar.getCalendarPermissionsAsync()).granted
      ? "granted"
      : "denied";
  } catch {
    return "unavailable";
  }
}

/**
 * The calendars on the phone, writable ones first.
 *
 * Read-only calendars are kept rather than filtered out: a subscribed holidays
 * calendar is a perfectly good thing to import FROM, and it is only exporting
 * to it that is impossible. Dropping it here would make the import list quietly
 * incomplete, which is worse than an option that is greyed out in one place.
 */
export async function listDeviceCalendars(): Promise<DeviceCalendar[]> {
  try {
    const found = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return found
      .map((c) => ({
        id: c.id,
        title: c.title,
        account: accountNameOf(c),
        colour: c.color,
        writable: c.allowsModifications,
        primary: c.isPrimary === true,
      }))
      .sort((a, b) =>
        a.writable === b.writable
          ? a.title.localeCompare(b.title)
          : a.writable
            ? -1
            : 1,
      );
  } catch {
    return [];
  }
}

/**
 * On iOS the source name is the account ("iCloud", "Gmail"); on Android the
 * owner account is the address itself. Neither is always present, and a
 * calendar with no account is a local one, which is what the phone calls it.
 */
function accountNameOf(c: Calendar.Calendar): string {
  return c.source?.name?.trim() || c.ownerAccount?.trim() || "On this phone";
}

/**
 * Where copies could go, as accounts rather than calendars.
 *
 * The phone's default calendar is the right answer for almost everybody, so it
 * is the default. The rest of this exists because "which native calendars do I
 * sync to" is usually really a question about accounts: somebody wants their
 * work Google calendar, not a calendar called Work.
 *
 * Accounts the phone does not have are still listed, with zero calendars. That
 * is the honest version of a placeholder: rather than offering Google Calendar
 * as though selecting it would do something, the screen can show it as an
 * account to add in the phone's own settings, which is the only place it can be
 * added from.
 */
export const KNOWN_ACCOUNTS = ["iCloud", "Google", "Outlook", "Exchange"] as const;

export function accountsFrom(calendars: readonly DeviceCalendar[]): DeviceAccount[] {
  const counts = new Map<string, number>();
  for (const c of calendars) counts.set(c.account, (counts.get(c.account) ?? 0) + 1);

  for (const known of KNOWN_ACCOUNTS) {
    // Matched loosely: iOS calls a Google account "Gmail" as often as "Google",
    // and an Exchange account is named after the server.
    const already = [...counts.keys()].some((name) => looksLike(name, known));
    if (!already) counts.set(known, 0);
  }

  return [...counts]
    .map(([name, calendarCount]) => ({ name, calendars: calendarCount }))
    .sort((a, b) => (b.calendars - a.calendars) || a.name.localeCompare(b.name));
}

function looksLike(name: string, known: string): boolean {
  const n = name.toLowerCase();
  const k = known.toLowerCase();
  if (n.includes(k)) return true;
  if (k === "google") return n.includes("gmail") || n.endsWith("@gmail.com");
  if (k === "outlook") return n.includes("hotmail") || n.includes("live.com");
  return false;
}

/** The calendar new events land in when nothing has been chosen. */
export async function defaultCalendarId(): Promise<string | null> {
  try {
    if (Platform.OS === "ios") return (await Calendar.getDefaultCalendarAsync()).id;
    const all = await listDeviceCalendars();
    // Android has no default-calendar API, so the primary writable one is the
    // closest true equivalent, and the first writable one after that.
    return all.find((c) => c.primary && c.writable)?.id ?? all.find((c) => c.writable)?.id ?? null;
  } catch {
    return null;
  }
}

// --- reading off the phone ---------------------------------------------------

/** How far ahead an import looks, in days. */
export const IMPORT_WINDOW_DAYS = 120;
/** And how far back, so this week's earlier days are not missing. */
export const IMPORT_BACK_DAYS = 7;

export async function readDeviceEvents(
  calendarIds: readonly string[],
  now = new Date(),
): Promise<(DeviceEvent & { deviceCalendarId: string; timeZone: string })[]> {
  if (calendarIds.length === 0) return [];
  const from = new Date(now.getTime() - IMPORT_BACK_DAYS * 86_400_000);
  const to = new Date(now.getTime() + IMPORT_WINDOW_DAYS * 86_400_000);

  try {
    const found = await Calendar.getEventsAsync([...calendarIds], from, to);
    return found.map((e) => ({
      deviceEventId: e.id,
      deviceCalendarId: e.calendarId,
      title: e.title?.trim() || "Busy",
      startUtc: asIso(e.startDate),
      endUtc: e.endDate ? asIso(e.endDate) : null,
      allDay: e.allDay === true,
      timeZone: e.timeZone || "UTC",
      // An event called off in the phone's calendar is not something to bring
      // in and show people as a plan. The other half of what this flag means in
      // @calder/core, a declined invitation, needs the attendee list, which is
      // a per-event round trip and is left for when it earns its cost.
      declined: e.status === Calendar.EventStatus.CANCELED,
    }));
  } catch {
    return [];
  }
}

/** expo-calendar hands back a Date on iOS and an ISO string on Android. */
function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * "2026-09-12T09:00:00", in the event's OWN zone rather than this phone's.
 *
 * A meeting created in New York keeps saying 9am when the person carrying the
 * phone lands in London, which is the whole reason the app stores a wall time
 * beside the instant.
 */
export function wallTimeIn(instant: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));

  const at = (name: string) => parts.find((p) => p.type === name)?.value ?? "00";
  // Some engines render midnight as hour 24 rather than 00.
  const hour = at("hour") === "24" ? "00" : at("hour");
  return `${at("year")}-${at("month")}-${at("day")}T${hour}:${at("minute")}:${at("second")}`;
}

// --- writing to the phone ----------------------------------------------------

export interface WriteResult {
  readonly created: { eventId: string; deviceEventId: string }[];
  /**
   * Not a count: the caller has to re-record the hash of everything it wrote,
   * and a number cannot say which ones those were. A run that reported only
   * how many it updated would leave their stored hashes stale, and every later
   * run would rewrite them all again.
   */
  readonly updated: { eventId: string; deviceEventId: string }[];
  readonly removed: string[];
  /** Copies we thought existed and did not, so their links can be dropped. */
  readonly vanished: string[];
  readonly failed: number;
}

/**
 * An all-day export is written as an all-day event.
 *
 * A "date" event here means a day was chosen and a time was not, which is
 * exactly what all-day means on a phone. Writing it as midnight instead puts a
 * whole-day trip in the 12am slot, above the alarm, which is how a synced
 * calendar starts to look like spam.
 */
function payloadFor(event: ExportableEvent) {
  const start = new Date(event.startUtc);
  const end = event.endUtc ? new Date(event.endUtc) : new Date(start.getTime() + 3_600_000);
  return {
    title: event.title,
    startDate: start,
    endDate: end,
    allDay: event.precision === "date",
    notes: "Added by Cal&der",
    // Nothing is written as busy or free deliberately: the phone's own default
    // is what the person already expects from every other app.
  };
}

/**
 * Carry out a plan.
 *
 * Each action is tried on its own and a failure is counted rather than thrown,
 * because the failures here are ordinary: an event was deleted on the phone
 * between planning and writing, or a calendar stopped being writable. Aborting
 * the batch would mean one stale copy prevents nineteen good ones, and the
 * caller cannot fix any of it anyway. A removal that fails because the copy is
 * already gone is not a failure at all, and comes back as vanished so its link
 * can be forgotten.
 */
export async function applyExport(
  actions: readonly ExportAction[],
  events: readonly ExportableEvent[],
  targetCalendarId: string,
): Promise<WriteResult> {
  const byId = new Map(events.map((e) => [e.eventId, e]));
  const created: { eventId: string; deviceEventId: string }[] = [];
  const updated: { eventId: string; deviceEventId: string }[] = [];
  const removed: string[] = [];
  const vanished: string[] = [];
  let failed = 0;

  for (const action of actions) {
    try {
      if (action.kind === "create") {
        const event = byId.get(action.eventId);
        if (!event) continue;
        const id = await Calendar.createEventAsync(targetCalendarId, payloadFor(event));
        created.push({ eventId: event.eventId, deviceEventId: id });
      } else if (action.kind === "update") {
        const event = byId.get(action.eventId);
        if (!event) continue;
        await Calendar.updateEventAsync(action.deviceEventId, payloadFor(event));
        updated.push({ eventId: event.eventId, deviceEventId: action.deviceEventId });
      } else {
        await Calendar.deleteEventAsync(action.deviceEventId);
        removed.push(action.deviceEventId);
      }
    } catch {
      if (action.kind === "remove") {
        // Already gone from the phone, which is the state we wanted anyway.
        vanished.push(action.deviceEventId);
      } else if (action.kind === "update") {
        // The copy has been deleted on the phone by hand. Forget the link so
        // the next run makes it again rather than failing on it forever.
        vanished.push(action.deviceEventId);
        failed += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { created, updated, removed, vanished, failed };
}
