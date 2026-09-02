/**
 * Queries. Deliberately shaped to mirror the access patterns in §4.4 rather than
 * whatever SQL happens to be convenient — so that when the sync layer arrives,
 * every screen is already asking for something the server can cheaply serve.
 */

import type { RsvpAnswer, RsvpStatus } from "@uca/core";
import { SERIES_DEFAULT, resolveRsvp, tallyRsvps } from "@uca/core";

import { getDb, notifyChanged } from "./client";
import { CURRENT_USER_ID } from "./seed";

export interface CalendarRow {
  calendar_id: string;
  name: string;
  description: string | null;
  mode: "bounded" | "continuous";
  start_date: string | null;
  end_date: string | null;
  default_tz: string;
  collect_availability: number;
  status: string;
}

export interface EventRow {
  event_id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  start_utc: string;
  end_utc: string | null;
  tz: string;
  local_wall: string;
  precision: "datetime" | "date" | "tbc";
  location_name: string | null;
  location_address: string | null;
  tickets_required: number;
  ticket_url: string | null;
  status: "active" | "cancelled";
  created_by: string;
  rrule: string | null;
  sync_state: "synced" | "pending" | "failed";
}

export interface MemberRow {
  user_id: string;
  role: "owner" | "member";
  status: "active" | "left" | "removed";
  display_name: string;
}

export interface RsvpRow {
  event_id: string;
  occurrence: string;
  user_id: string;
  status: RsvpStatus;
  has_ticket: number | null;
  effective_from: string | null;
}

/** Access pattern 1. */
export function listCalendars(): CalendarRow[] {
  return getDb().getAllSync<CalendarRow>(
    `SELECT c.* FROM calendars c
       JOIN members m ON m.calendar_id = c.calendar_id
      WHERE m.user_id = ? AND m.status = 'active' AND c.status = 'active'
      ORDER BY c.mode = 'continuous', COALESCE(c.start_date, '9999'), c.name`,
    [CURRENT_USER_ID],
  );
}

export function getCalendar(calendarId: string): CalendarRow | null {
  return getDb().getFirstSync<CalendarRow>(
    "SELECT * FROM calendars WHERE calendar_id = ?",
    [calendarId],
  );
}

/**
 * Only ACTIVE members. Elsewhere the full list is wanted — a departed member
 * still has to resolve to a name on events they created (§8.4) — so the caller
 * chooses rather than this being baked in.
 */
export function listMembers(calendarId: string, activeOnly = true): MemberRow[] {
  return getDb().getAllSync<MemberRow>(
    `SELECT user_id, role, status, display_name FROM members
      WHERE calendar_id = ?${activeOnly ? " AND status = 'active'" : ""}
      ORDER BY role = 'member', display_name`,
    [calendarId],
  );
}

/** Access pattern 4, scoped to one calendar. */
export function listEvents(calendarId: string): EventRow[] {
  return getDb().getAllSync<EventRow>(
    `SELECT * FROM events WHERE calendar_id = ? ORDER BY start_utc`,
    [calendarId],
  );
}

export function getEvent(eventId: string): EventRow | null {
  return getDb().getFirstSync<EventRow>(
    "SELECT * FROM events WHERE event_id = ?",
    [eventId],
  );
}

/** Access pattern 13: my upcoming events across every calendar. */
export function listAgenda(limit = 100): (EventRow & { calendar_name: string })[] {
  return getDb().getAllSync<EventRow & { calendar_name: string }>(
    `SELECT e.*, c.name AS calendar_name
       FROM events e
       JOIN calendars c ON c.calendar_id = e.calendar_id
       JOIN members m ON m.calendar_id = e.calendar_id AND m.user_id = ?
      WHERE m.status = 'active' AND e.start_utc >= ?
      ORDER BY e.start_utc
      LIMIT ?`,
    [CURRENT_USER_ID, new Date().toISOString(), limit],
  );
}

export function listRsvps(eventId: string): RsvpRow[] {
  return getDb().getAllSync<RsvpRow>(
    "SELECT * FROM rsvps WHERE event_id = ?",
    [eventId],
  );
}

export function listRsvpsForCalendar(calendarId: string): RsvpRow[] {
  return getDb().getAllSync<RsvpRow>(
    "SELECT * FROM rsvps WHERE calendar_id = ?",
    [calendarId],
  );
}

const toAnswer = (r: RsvpRow): RsvpAnswer => ({
  occurrence: r.occurrence,
  status: r.status,
  ...(r.has_ticket === null ? {} : { hasTicket: r.has_ticket === 1 }),
  ...(r.effective_from === null ? {} : { effectiveFrom: r.effective_from }),
});

/**
 * Resolution lives in @uca/core, not here. The occurrence-beats-series-default
 * rule has to be identical on the client and in the API, and the surest way to
 * achieve that is for there to be one implementation (§5.5).
 */
export function resolveForUser(
  rows: readonly RsvpRow[],
  eventId: string,
  occurrence: string,
  userId: string,
) {
  const mine = rows.filter((r) => r.event_id === eventId && r.user_id === userId);
  const exact = mine.find((r) => r.occurrence === occurrence);
  const series = mine.find((r) => r.occurrence === SERIES_DEFAULT);
  return resolveRsvp(
    occurrence,
    exact ? toAnswer(exact) : null,
    series ? toAnswer(series) : null,
  );
}

export function tallyForEvent(
  rows: readonly RsvpRow[],
  eventId: string,
  occurrence: string,
  members: readonly MemberRow[],
) {
  const resolved = members.map((m) =>
    resolveForUser(rows, eventId, occurrence, m.user_id),
  );
  return tallyRsvps(resolved, members.length);
}

/**
 * The highest-frequency write in the app, and the one that can never conflict —
 * the key includes the user id (§4.4 pattern 5). It is applied locally and
 * immediately; a queued mutation carries it to the server later.
 */
export function setRsvp(
  calendarId: string,
  eventId: string,
  occurrence: string,
  status: RsvpStatus,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO rsvps (event_id, occurrence, user_id, calendar_id, status, responded_at, sync_state)
       VALUES (?,?,?,?,?,?, 'pending')
       ON CONFLICT (event_id, occurrence, user_id)
       DO UPDATE SET status = excluded.status,
                     responded_at = excluded.responded_at,
                     sync_state = 'pending'`,
      [eventId, occurrence, CURRENT_USER_ID, calendarId, status, now],
    );

    db.runSync(
      `INSERT INTO mutation_queue (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?,?,?,?,?)`,
      [
        `${eventId}:${occurrence}:${CURRENT_USER_ID}:${now}`,
        calendarId,
        "PUT",
        `/v1/calendars/${calendarId}/events/${eventId}/rsvp`,
        JSON.stringify({ occurrence, status }),
        now,
      ],
    );
  });

  notifyChanged();
}

export function clearRsvp(eventId: string, occurrence: string): void {
  getDb().runSync(
    "DELETE FROM rsvps WHERE event_id = ? AND occurrence = ? AND user_id = ?",
    [eventId, occurrence, CURRENT_USER_ID],
  );
  notifyChanged();
}

export function pendingMutationCount(): number {
  const row = getDb().getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM mutation_queue",
  );
  return row?.n ?? 0;
}
