/**
 * Queries. Deliberately shaped to mirror the access patterns in §4.4 rather than
 * whatever SQL happens to be convenient — so that when the sync layer arrives,
 * every screen is already asking for something the server can cheaply serve.
 */

import type {
  DayPresence,
  ExportableEvent,
  NotificationKind,
  NotificationSurface,
  RsvpAnswer,
  RsvpStatus,
  SyncDirection,
  SyncLink,
  SyncPrefs,
  TicketStatus,
  TravelMode,
} from "@calder/core";
import type { SchedulingMode, SlotResponse } from "@calder/core";
import {
  DEFAULT_SYNC_PREFS,
  SERIES_DEFAULT,
  classifyPresence,
  isActionable,
  newCalendarId,
  newEventId,
  resolveRsvp,
  surfaceFor,
  syncHash,
  tallyRsvps,
  ulid,
} from "@calder/core";

import type { Appearance } from "@/theme";

import { getDb, notifyChanged } from "./client";
import {
  CURRENT_USER_ID,
  ensureOwnPlans,
  fixturesWanted,
  loadFixtures,
  OWN_PLANS_ID,
} from "./seed";

export interface CalendarRow {
  calendar_id: string;
  name: string;
  description: string | null;
  mode: "bounded" | "continuous";
  start_date: string | null;
  end_date: string | null;
  default_tz: string;
  collect_availability: number;
  travel_mode: TravelMode;
  cover_image: string | null;
  is_private: number;
  require_approval: number;
  allow_member_invites: number;
  allow_member_events: number;
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
  image_key: string | null;
  updated_by: string | null;
  updated_at: string | null;
  scheduling_mode: SchedulingMode;
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
  ticket_status: TicketStatus | null;
  effective_from: string | null;
}

/** Access pattern 1. */
export function listCalendars(): (CalendarRow & { my_role: "owner" | "member" })[] {
  return getDb().getAllSync<CalendarRow & { my_role: "owner" | "member" }>(
    `SELECT c.*, m.role AS my_role FROM calendars c
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
      WHERE m.status = 'active' AND c.status = 'active' AND e.start_utc >= ?
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
  ...(r.ticket_status === null ? {} : { ticketStatus: r.ticket_status }),
  ...(r.effective_from === null ? {} : { effectiveFrom: r.effective_from }),
});

/**
 * Resolution lives in @calder/core, not here. The occurrence-beats-series-default
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

/**
 * Withdrawing an answer, which returns the person to "hasn't replied" rather
 * than to "not going". The two are different states and the tally counts them
 * separately (§3.5).
 */
export function clearRsvp(eventId: string, occurrence: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const row = db.getFirstSync<{ calendar_id: string }>(
    "SELECT calendar_id FROM rsvps WHERE event_id = ? AND occurrence = ? AND user_id = ?",
    [eventId, occurrence, CURRENT_USER_ID],
  );
  if (!row) return;

  db.withTransactionSync(() => {
    db.runSync(
      "DELETE FROM rsvps WHERE event_id = ? AND occurrence = ? AND user_id = ?",
      [eventId, occurrence, CURRENT_USER_ID],
    );
    db.runSync(
      `INSERT INTO mutation_queue (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?, 'DELETE', ?, ?, ?)`,
      [
        `rsvp-clear:${eventId}:${occurrence}:${CURRENT_USER_ID}:${now}`,
        row.calendar_id,
        `/v1/calendars/${row.calendar_id}/events/${eventId}/rsvp`,
        JSON.stringify({ occurrence }),
        now,
      ],
    );
  });

  notifyChanged();
}

export function pendingMutationCount(): number {
  const row = getDb().getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM mutation_queue",
  );
  return row?.n ?? 0;
}

// --- inbox: People and Activity (§7.3) -------------------------------------

export interface NotificationRow {
  notification_id: string;
  kind: NotificationKind;
  created_at: string;
  read_at: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  event_id: string | null;
  event_title: string | null;
  actor_name: string | null;
}

export interface PendingInviteRow {
  calendar_id: string;
  calendar_name: string;
  calendar_mode: "bounded" | "continuous";
  start_date: string | null;
  end_date: string | null;
  event_count: number;
  member_count: number;
  invited_by_name: string;
  invited_at: string;
  state: "pending" | "accepted" | "declined";
}

function notificationsFor(surface: NotificationSurface): NotificationRow[] {
  const all = getDb().getAllSync<NotificationRow>(
    "SELECT * FROM notifications ORDER BY created_at DESC",
  );
  // The split lives in @calder/core so the two surfaces cannot disagree.
  return all.filter((n) => surfaceFor(n.kind) === surface);
}

export const listActivity = (): NotificationRow[] => notificationsFor("activity");
export const listPeopleNotifications = (): NotificationRow[] =>
  notificationsFor("people");

export function listPendingInvites(): PendingInviteRow[] {
  return getDb().getAllSync<PendingInviteRow>(
    "SELECT * FROM pending_invites WHERE state = 'pending' ORDER BY invited_at DESC",
  );
}

/**
 * Badges count only what is WAITING ON YOU, not everything unread. A badge that
 * counts ambient news teaches people to ignore it.
 */
export function badgeCounts(): { people: number; activity: number } {
  const unread = getDb().getAllSync<NotificationRow>(
    "SELECT * FROM notifications WHERE read_at IS NULL",
  );
  const invites = listPendingInvites().length;

  let activity = 0;
  for (const n of unread) {
    if (surfaceFor(n.kind) === "activity" && isActionable(n.kind)) activity += 1;
  }

  const friendRequests =
    getDb().getFirstSync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM friends WHERE status = 'pending_in'",
    )?.n ?? 0;

  const eventInvites =
    getDb().getFirstSync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM event_invites WHERE to_user = ? AND status = 'pending'",
      [CURRENT_USER_ID],
    )?.n ?? 0;

  return { people: invites + friendRequests + eventInvites, activity };
}

export function markSurfaceRead(surface: NotificationSurface): void {
  const rows = notificationsFor(surface).filter((n) => n.read_at === null);
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const db = getDb();
  db.withTransactionSync(() => {
    for (const r of rows) {
      db.runSync("UPDATE notifications SET read_at = ? WHERE notification_id = ?", [
        now,
        r.notification_id,
      ]);
    }
  });
  notifyChanged();
}

export function answerInvite(calendarId: string, accept: boolean): void {
  getDb().runSync("UPDATE pending_invites SET state = ? WHERE calendar_id = ?", [
    accept ? "accepted" : "declined",
    calendarId,
  ]);
  notifyChanged();
}

// --- derived connections (§7.2) -------------------------------------------

export interface ConnectionRow {
  user_id: string;
  display_name: string;
  shared: number;
}

/**
 * "People you have planned with", computed from shared calendar membership.
 *
 * There is no friends graph, no requests and no search (decision 8): the graph
 * already exists implicitly, the client already holds every calendar it belongs
 * to, and so this is a local query with no backend behind it at all.
 */
export function listConnections(): ConnectionRow[] {
  return getDb().getAllSync<ConnectionRow>(
    `SELECT other.user_id,
            other.display_name,
            COUNT(DISTINCT other.calendar_id) AS shared
       FROM members me
       JOIN members other ON other.calendar_id = me.calendar_id
      WHERE me.user_id = ?
        AND me.status = 'active'
        AND other.user_id != me.user_id
        AND other.status = 'active'
      GROUP BY other.user_id, other.display_name
      ORDER BY shared DESC, other.display_name`,
    [CURRENT_USER_ID],
  );
}

// --- friends (§7.3) --------------------------------------------------------
//
// Prototype against local data: the `directory` table stands in for the
// discovery API, and only the current user's `friends` rows exist. The shapes
// match §7.3 so that swapping the queries for API calls is a contained change.

export type FriendStatus = "pending_out" | "pending_in" | "accepted";

export interface PersonRow {
  user_id: string;
  handle: string;
  display_name: string;
  email: string | null;
  status: FriendStatus | null;
  grants: "none" | "busy" | "full" | null;
}

export interface SuggestionRow extends PersonRow {
  shared_calendars: number;
  mutual_events: number;
}

const PERSON_SELECT = `
  SELECT d.user_id, d.handle, d.display_name, d.email, f.status, f.grants
    FROM directory d
    LEFT JOIN friends f ON f.user_id = d.user_id
`;

/**
 * One search box over handle, name and email (§7.3).
 *
 * A leading sigil is stripped so that typing a handle the way people write it
 * still matches. Both "&" and "@" are accepted: "&" is ours, and "@" is what
 * fingers do by habit — refusing it would be a search that fails for a reason
 * nobody can see.
 */
export function searchPeople(query: string): PersonRow[] {
  const q = query.trim().replace(/^[&@]+/, "").toLowerCase();
  if (q.length === 0) return [];

  return getDb().getAllSync<PersonRow>(
    `${PERSON_SELECT}
      WHERE d.user_id != ?
        AND (d.handle LIKE ? OR LOWER(d.display_name) LIKE ? OR LOWER(d.email) LIKE ?)
      ORDER BY
        -- exact handle first, then handle prefix, then everything else
        CASE WHEN d.handle = ? THEN 0
             WHEN d.handle LIKE ? THEN 1
             ELSE 2 END,
        d.display_name
      LIMIT 20`,
    [CURRENT_USER_ID, `%${q}%`, `%${q}%`, `%${q}%`, q, `${q}%`],
  );
}

/**
 * Suggestions: people you have planned with who are not already friends.
 *
 * Ranked by shared calendars and by how many events you have both been Going to
 * — the derived-connections query of §7.2, doing the job it survived the
 * reversal to do: stopping the friends screen from opening empty.
 */
export function listSuggestions(): SuggestionRow[] {
  return getDb().getAllSync<SuggestionRow>(
    `SELECT d.user_id, d.handle, d.display_name, d.email, f.status, f.grants,
            COUNT(DISTINCT other.calendar_id) AS shared_calendars,
            (SELECT COUNT(*)
               FROM rsvps mine
               JOIN rsvps theirs
                 ON theirs.event_id = mine.event_id
                AND theirs.occurrence = mine.occurrence
              WHERE mine.user_id = ?
                AND theirs.user_id = d.user_id
                AND mine.status = 'going'
                AND theirs.status = 'going') AS mutual_events
       FROM members me
       JOIN members other ON other.calendar_id = me.calendar_id
       JOIN directory d ON d.user_id = other.user_id
       LEFT JOIN friends f ON f.user_id = d.user_id
      WHERE me.user_id = ?
        AND me.status = 'active'
        AND other.status = 'active'
        AND other.user_id != me.user_id
        AND f.user_id IS NULL
      GROUP BY d.user_id, d.handle, d.display_name, d.email, f.status, f.grants
      ORDER BY mutual_events DESC, shared_calendars DESC, d.display_name`,
    [CURRENT_USER_ID, CURRENT_USER_ID],
  );
}

export function listFriends(status: FriendStatus): PersonRow[] {
  return getDb().getAllSync<PersonRow>(
    `${PERSON_SELECT} WHERE f.status = ? ORDER BY d.display_name`,
    [status],
  );
}

export function sendFriendRequest(userId: string): void {
  getDb().runSync(
    `INSERT INTO friends (user_id, status, grants, since) VALUES (?, 'pending_out', 'none', ?)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, new Date().toISOString()],
  );
  notifyChanged();
}

export function acceptFriendRequest(userId: string): void {
  getDb().runSync(
    "UPDATE friends SET status = 'accepted', since = ? WHERE user_id = ?",
    [new Date().toISOString(), userId],
  );
  notifyChanged();
}

/** Declining, cancelling an outgoing request and unfriending are the same write. */
export function removeFriend(userId: string): void {
  getDb().runSync("DELETE FROM friends WHERE user_id = ?", [userId]);
  notifyChanged();
}

export type FriendGrants = "none" | "busy" | "full";

/**
 * What this friend may see of me (§7.4). Stored per direction: it says nothing
 * about what they show me.
 *
 * The value is recorded now and has no effect until free/busy exists — but the
 * *state* is worth surfacing immediately, because §7.4 requires that who can see
 * what is permanently visible rather than buried in a settings screen.
 */
export function setFriendGrants(userId: string, grants: FriendGrants): void {
  getDb().runSync("UPDATE friends SET grants = ? WHERE user_id = ?", [
    grants,
    userId,
  ]);
  notifyChanged();
}

// --- creating a calendar (§3.5) --------------------------------------------

export interface NewCalendar {
  name: string;
  mode: "bounded" | "continuous";
  startDate?: string;
  endDate?: string;
  defaultTz: string;
  collectAvailability: boolean;
  allowMemberEvents: boolean;
  travelMode: TravelMode;
  isPrivate: boolean;
  coverImage?: string | null;
}

/**
 * Creates the calendar and the creator's owner membership in one transaction —
 * a calendar with no owner is unadministrable (§8.3), so the two are never
 * separate writes.
 *
 * The id is a client-generated ULID, which is what makes the write idempotent by
 * primary key and lets this work with no network at all (§5.3).
 */
export function createCalendar(input: NewCalendar): string {
  const db = getDb();
  const calendarId = newCalendarId();
  const now = new Date().toISOString();

  db.withTransactionSync(() => {
    db.runSync(
      // Every column this binds is named. is_private and cover_image were
      // missing from the list while still being passed, which shifted every
      // parameter after them by two: created_by took the privacy flag and
      // created_at took the cover, which is a crash when there is no cover and,
      // worse, silently wrong data when there is one.
      `INSERT INTO calendars (calendar_id, name, description, mode, start_date, end_date,
         default_tz, collect_availability, travel_mode, require_approval,
         allow_member_invites, allow_member_events, is_private, cover_image,
         status, created_by, created_at, last_seq)
       VALUES (?,?,NULL,?,?,?,?,?,?,1,1,?,?,?,'active',?,?,0)`,
      [
        calendarId,
        input.name.trim(),
        input.mode,
        input.startDate ?? null,
        input.endDate ?? null,
        input.defaultTz,
        input.collectAvailability ? 1 : 0,
        input.travelMode,
        input.allowMemberEvents ? 1 : 0,
        input.isPrivate ? 1 : 0,
        input.coverImage ?? null,
        CURRENT_USER_ID,
        now,
      ],
    );

    db.runSync(
      `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
       VALUES (?,?, 'owner', 'active', ?, ?)`,
      // The name they chose at first run, not a fixture's.
      [calendarId, CURRENT_USER_ID, getProfile().displayName, now],
    );

    db.runSync(
      `INSERT INTO mutation_queue (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?, 'PUT', ?, ?, ?)`,
      [
        `create:${calendarId}`,
        calendarId,
        `/v1/calendars/${calendarId}`,
        JSON.stringify(input),
        now,
      ],
    );
  });

  notifyChanged();
  return calendarId;
}

// --- presence (§4.3) -------------------------------------------------------

export interface AvailabilityRow {
  user_id: string;
  arrives_at: string | null;
  departs_at: string | null;
  travel_mode: TravelMode | null;
  /** Null means they leave the way they arrived. */
  travel_mode_out: TravelMode | null;
}

export function listAvailability(calendarId: string): AvailabilityRow[] {
  return getDb().getAllSync<AvailabilityRow>(
    `SELECT user_id, arrives_at, departs_at, travel_mode, travel_mode_out
       FROM availability WHERE calendar_id = ?`,
    [calendarId],
  );
}

/**
 * Presence for one day, classified in @calder/core so the client and the future API
 * cannot disagree about who counts as "here".
 *
 * Members who have said nothing appear as `unknown` rather than being assumed
 * present — the difference between "Glenn isn't coming" and "Glenn hasn't said"
 * is the whole reason to ask.
 */
export function presenceForDay(
  calendarId: string,
  dayStartUtc: string,
  dayEndUtc: string,
): DayPresence {
  const members = listMembers(calendarId);
  const availability = listAvailability(calendarId);
  const byUser = new Map(availability.map((a) => [a.user_id, a]));

  return classifyPresence(
    members.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      arrivesAt: byUser.get(m.user_id)?.arrives_at ?? null,
      departsAt: byUser.get(m.user_id)?.departs_at ?? null,
      travelMode: byUser.get(m.user_id)?.travel_mode ?? null,
      travelModeOut: byUser.get(m.user_id)?.travel_mode_out ?? null,
    })),
    dayStartUtc,
    dayEndUtc,
  );
}

// --- calendar settings -----------------------------------------------------

export function myMembership(calendarId: string): MemberRow | null {
  return getDb().getFirstSync<MemberRow>(
    `SELECT user_id, role, status, display_name FROM members
      WHERE calendar_id = ? AND user_id = ?`,
    [calendarId, CURRENT_USER_ID],
  );
}

export function myAvailability(calendarId: string): AvailabilityRow | null {
  return getDb().getFirstSync<AvailabilityRow>(
    `SELECT user_id, arrives_at, departs_at, travel_mode, travel_mode_out
       FROM availability WHERE calendar_id = ? AND user_id = ?`,
    [calendarId, CURRENT_USER_ID],
  );
}

export function setMyAvailability(
  calendarId: string,
  arrivesAt: string | null,
  departsAt: string | null,
  travelMode: TravelMode | null = null,
  /** Null means "the same way I came", not "unset". */
  travelModeOut: TravelMode | null = null,
): void {
  getDb().runSync(
    `INSERT INTO availability
       (calendar_id, user_id, arrives_at, departs_at, travel_mode, travel_mode_out, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (calendar_id, user_id)
     DO UPDATE SET arrives_at = excluded.arrives_at,
                   departs_at = excluded.departs_at,
                   travel_mode = excluded.travel_mode,
                   travel_mode_out = excluded.travel_mode_out,
                   updated_at = excluded.updated_at`,
    [
      calendarId,
      CURRENT_USER_ID,
      arrivesAt,
      departsAt,
      travelMode,
      travelModeOut,
      new Date().toISOString(),
    ],
  );
  notifyChanged();
}

export function updateCalendar(
  calendarId: string,
  patch: Partial<{
    name: string;
    collectAvailability: boolean;
    requireApproval: boolean;
    allowMemberInvites: boolean;
    allowMemberEvents: boolean;
    travelMode: TravelMode;
    coverImage: string | null;
    isPrivate: boolean;
  }>,
): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];

  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name.trim());
  }
  if (patch.collectAvailability !== undefined) {
    sets.push("collect_availability = ?");
    args.push(patch.collectAvailability ? 1 : 0);
  }
  if (patch.requireApproval !== undefined) {
    sets.push("require_approval = ?");
    args.push(patch.requireApproval ? 1 : 0);
  }
  if (patch.allowMemberInvites !== undefined) {
    sets.push("allow_member_invites = ?");
    args.push(patch.allowMemberInvites ? 1 : 0);
  }
  if (patch.allowMemberEvents !== undefined) {
    sets.push("allow_member_events = ?");
    args.push(patch.allowMemberEvents ? 1 : 0);
  }
  if (patch.travelMode !== undefined) {
    sets.push("travel_mode = ?");
    args.push(patch.travelMode);
  }
  if (patch.coverImage !== undefined) {
    sets.push("cover_image = ?");
    args.push(patch.coverImage);
  }
  if (patch.isPrivate !== undefined) {
    sets.push("is_private = ?");
    args.push(patch.isPrivate ? 1 : 0);
  }
  if (sets.length === 0) return;

  args.push(calendarId);
  getDb().runSync(
    `UPDATE calendars SET ${sets.join(", ")} WHERE calendar_id = ?`,
    args,
  );
  notifyChanged();
}

export function setMemberRole(
  calendarId: string,
  userId: string,
  role: "owner" | "member",
): void {
  getDb().runSync(
    "UPDATE members SET role = ? WHERE calendar_id = ? AND user_id = ?",
    [role, calendarId, userId],
  );
  notifyChanged();
}

/**
 * Removal and leaving are the same write: the membership is soft-deleted so the
 * person still resolves to a name on events they created (§4.5, §8.4).
 */
export function setMemberStatus(
  calendarId: string,
  userId: string,
  status: "left" | "removed",
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync(
      "UPDATE members SET status = ? WHERE calendar_id = ? AND user_id = ?",
      [status, calendarId, userId],
    );
    // Queued like every other write, so leaving on a plane still leaves.
    db.runSync(
      `INSERT OR REPLACE INTO mutation_queue (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?, 'DELETE', ?, ?, ?)`,
      [
        `member:${calendarId}:${userId}:${status}`,
        calendarId,
        `/v1/calendars/${calendarId}/members/${userId}`,
        JSON.stringify({ status }),
        now,
      ],
    );
  });
  notifyChanged();
}

/**
 * An owner may leave freely while other owners remain. Only a departure that
 * would take the calendar to zero owners is blocked, because nobody could then
 * approve joins, cancel events or delete it (§8.4).
 */
export function leavingWouldOrphanCalendar(calendarId: string): boolean {
  const owners = getDb().getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM members
      WHERE calendar_id = ? AND status = 'active' AND role = 'owner' AND user_id != ?`,
    [calendarId, CURRENT_USER_ID],
  );
  const me = myMembership(calendarId);
  return me?.role === "owner" && (owners?.n ?? 0) === 0;
}

// --- invites sent from this calendar ---------------------------------------

export interface SentInviteRow {
  user_id: string;
  display_name: string;
  handle: string;
  invited_at: string;
}

export function listSentInvites(calendarId: string): SentInviteRow[] {
  return getDb().getAllSync<SentInviteRow>(
    `SELECT s.user_id, s.invited_at, d.display_name, d.handle
       FROM sent_invites s JOIN directory d ON d.user_id = s.user_id
      WHERE s.calendar_id = ? ORDER BY s.invited_at DESC`,
    [calendarId],
  );
}

export function inviteUser(calendarId: string, userId: string): void {
  getDb().runSync(
    `INSERT INTO sent_invites (calendar_id, user_id, invited_at) VALUES (?,?,?)
     ON CONFLICT (calendar_id, user_id) DO NOTHING`,
    [calendarId, userId, new Date().toISOString()],
  );
  notifyChanged();
}

export interface InviteLinkRow {
  token: string;
  created_at: string;
  uses: number;
}

export function getInviteLink(calendarId: string): InviteLinkRow | null {
  return getDb().getFirstSync<InviteLinkRow>(
    "SELECT token, created_at, uses FROM invite_links WHERE calendar_id = ?",
    [calendarId],
  );
}

/**
 * One live link per calendar. Rotating replaces the token, which revokes every
 * copy already shared — the reason §7.1 chose a single rotating link over
 * per-person tokens.
 */
export function rotateInviteLink(calendarId: string): InviteLinkRow {
  const token = ulid().toLowerCase();
  const now = new Date().toISOString();
  getDb().runSync(
    `INSERT INTO invite_links (calendar_id, token, created_at, uses) VALUES (?,?,?,0)
     ON CONFLICT (calendar_id)
     DO UPDATE SET token = excluded.token, created_at = excluded.created_at, uses = 0`,
    [calendarId, token, now],
  );
  notifyChanged();
  return { token, created_at: now, uses: 0 };
}

// --- creating events (§3.5) ------------------------------------------------

export interface NewEvent {
  title: string;
  description?: string;
  startUtc: string;
  endUtc?: string | null;
  tz: string;
  localWall: string;
  precision: "datetime" | "date" | "tbc";
  locationName?: string | null;
  locationAddress?: string | null;
  ticketsRequired: boolean;
  ticketUrl?: string | null;
  /**
   * A picture for the event. Local file URI for now: uploading it is the
   * server's job (§3.4), and the client only remembers which one was chosen.
   */
  imageKey?: string | null;
}

export function createEvent(calendarId: string, input: NewEvent): string {
  const db = getDb();
  const eventId = newEventId();
  const now = new Date().toISOString();

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
         tz, local_wall, precision, location_name, location_address, tickets_required,
         ticket_url, allow_suggestions, status, created_by, created_at, version, rrule,
         image_key, sync_state)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active',?,?,1,NULL,?,'pending')`,
      [
        eventId,
        calendarId,
        input.title.trim(),
        input.description?.trim() || null,
        input.startUtc,
        input.endUtc ?? null,
        input.tz,
        input.localWall,
        input.precision,
        input.locationName?.trim() || null,
        input.locationAddress?.trim() || null,
        input.ticketsRequired ? 1 : 0,
        input.ticketUrl?.trim() || null,
        CURRENT_USER_ID,
        now,
        input.imageKey ?? null,
      ],
    );

    db.runSync(
      `INSERT INTO mutation_queue (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?, 'PUT', ?, ?, ?)`,
      [
        `event:${eventId}`,
        calendarId,
        `/v1/calendars/${calendarId}/events/${eventId}`,
        JSON.stringify(input),
        now,
      ],
    );
  });

  notifyChanged();
  return eventId;
}

/**
 * Two people adding the same gig is the most common annoyance in a shared
 * calendar, so it is caught at the moment of typing rather than left to be
 * cleaned up later. Runs against the local mirror, so it costs nothing and works
 * offline (§3.5).
 *
 * Deliberately loose: a near miss is worth showing, because the cost of a false
 * positive is a glance and the cost of a miss is a duplicate.
 */
export function findSimilarEvents(
  calendarId: string,
  title: string,
  startUtc: string,
): EventRow[] {
  const words = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (words.length === 0) return [];

  const windowMs = 12 * 60 * 60 * 1000;
  const from = new Date(new Date(startUtc).getTime() - windowMs).toISOString();
  const to = new Date(new Date(startUtc).getTime() + windowMs).toISOString();

  return getDb()
    .getAllSync<EventRow>(
      `SELECT * FROM events
        WHERE calendar_id = ? AND status = 'active' AND start_utc BETWEEN ? AND ?`,
      [calendarId, from, to],
    )
    .filter((e) => {
      const existing = e.title.toLowerCase();
      return words.some((w) => existing.includes(w));
    });
}

/**
 * Where I stand on getting a ticket for this event.
 *
 * Only meaningful once someone is coming, so setting it implies an RSVP: nobody
 * hunts for a ticket to something they are not attending. Answering here rather
 * than making them answer twice is the whole point.
 */
export function setMyTicketStatus(
  calendarId: string,
  eventId: string,
  occurrence: string,
  ticket: TicketStatus | null,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO rsvps (event_id, occurrence, user_id, calendar_id, status, responded_at, ticket_status, sync_state)
       VALUES (?,?,?,?, 'going', ?, ?, 'pending')
       ON CONFLICT (event_id, occurrence, user_id)
       DO UPDATE SET ticket_status = excluded.ticket_status,
                     sync_state = 'pending'`,
      [eventId, occurrence, CURRENT_USER_ID, calendarId, now, ticket],
    );

    db.runSync(
      `INSERT INTO mutation_queue (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?, 'PUT', ?, ?, ?)`,
      [
        `ticket:${eventId}:${occurrence}:${CURRENT_USER_ID}:${now}`,
        calendarId,
        `/v1/calendars/${calendarId}/events/${eventId}/rsvp/ticket`,
        JSON.stringify({ occurrence, ticketStatus: ticket }),
        now,
      ],
    );
  });

  notifyChanged();
}

// --- joining by link (§7.1, §3.5) ------------------------------------------

export interface InvitePreview {
  calendarId: string;
  name: string;
  mode: "bounded" | "continuous";
  startDate: string | null;
  endDate: string | null;
  eventCount: number;
  memberCount: number;
  invitedByName: string;
  alreadyMember: boolean;
  requestPending: boolean;
  requiresApproval: boolean;
}

/**
 * What a person sees before signing in or joining.
 *
 * Returns COUNTS ONLY. Never member names, never event titles: an invite link is
 * a bearer token that gets forwarded and screenshotted, so anything this returns
 * should be safe in the hands of a stranger (§3.5).
 *
 * In production this is the one unauthenticated route in the system.
 */
export function previewInvite(token: string): InvitePreview | null {
  const db = getDb();

  const link = db.getFirstSync<{ calendar_id: string; created_at: string }>(
    "SELECT calendar_id, created_at FROM invite_links WHERE token = ?",
    [token],
  );
  if (!link) return null;

  const calendar = getCalendar(link.calendar_id);
  if (!calendar || calendar.status !== "active") return null;

  const counts = db.getFirstSync<{ events: number; members: number }>(
    `SELECT
       (SELECT COUNT(*) FROM events WHERE calendar_id = ? AND status = 'active') AS events,
       (SELECT COUNT(*) FROM members WHERE calendar_id = ? AND status = 'active') AS members`,
    [link.calendar_id, link.calendar_id],
  );

  const owner = db.getFirstSync<{ display_name: string }>(
    `SELECT display_name FROM members
      WHERE calendar_id = ? AND role = 'owner' AND status = 'active'
      ORDER BY joined_at LIMIT 1`,
    [link.calendar_id],
  );

  const mine = myMembership(link.calendar_id);
  const pending = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM join_requests WHERE calendar_id = ? AND user_id = ?",
    [link.calendar_id, CURRENT_USER_ID],
  );

  return {
    calendarId: link.calendar_id,
    name: calendar.name,
    mode: calendar.mode,
    startDate: calendar.start_date,
    endDate: calendar.end_date,
    eventCount: counts?.events ?? 0,
    memberCount: counts?.members ?? 0,
    invitedByName: owner?.display_name ?? "Someone",
    alreadyMember: mine?.status === "active",
    requestPending: (pending?.n ?? 0) > 0,
    requiresApproval: calendar.require_approval === 1,
  };
}

export type JoinOutcome = "joined" | "requested" | "already";

/**
 * Every joiner is approved when the calendar says so, with no exceptions, and a
 * previously removed person is forced through approval whatever the calendar
 * says (§7.1, §8.4).
 */
export function joinByToken(token: string): JoinOutcome | null {
  const db = getDb();
  const preview = previewInvite(token);
  if (!preview) return null;
  if (preview.alreadyMember) return "already";

  const prior = db.getFirstSync<{ status: string; was_removed: number }>(
    "SELECT status FROM members WHERE calendar_id = ? AND user_id = ?",
    [preview.calendarId, CURRENT_USER_ID],
  );
  const wasRemoved = prior?.status === "removed";
  const now = new Date().toISOString();

  if (preview.requiresApproval || wasRemoved) {
    db.runSync(
      `INSERT INTO join_requests (calendar_id, user_id, display_name, requested_at, via_token, previously_removed)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (calendar_id, user_id) DO NOTHING`,
      [
        preview.calendarId,
        CURRENT_USER_ID,
        getProfile().displayName,
        now,
        token,
        wasRemoved ? 1 : 0,
      ],
    );
    notifyChanged();
    return "requested";
  }

  db.runSync(
    `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
     VALUES (?,?, 'member', 'active', ?, ?)
     ON CONFLICT (calendar_id, user_id)
     DO UPDATE SET status = 'active', joined_at = excluded.joined_at`,
    [preview.calendarId, CURRENT_USER_ID, getProfile().displayName, now],
  );
  db.runSync("UPDATE invite_links SET uses = uses + 1 WHERE token = ?", [token]);
  notifyChanged();
  return "joined";
}

// --- approving joiners (§7.1) ----------------------------------------------

export interface JoinRequestRow {
  user_id: string;
  display_name: string;
  requested_at: string;
  via_token: string | null;
  previously_removed: number;
}

export function listJoinRequests(calendarId: string): JoinRequestRow[] {
  return getDb().getAllSync<JoinRequestRow>(
    `SELECT user_id, display_name, requested_at, via_token, previously_removed
       FROM join_requests WHERE calendar_id = ? ORDER BY requested_at`,
    [calendarId],
  );
}

export function answerJoinRequest(
  calendarId: string,
  userId: string,
  approve: boolean,
): void {
  const db = getDb();
  const request = db.getFirstSync<{ display_name: string }>(
    "SELECT display_name FROM join_requests WHERE calendar_id = ? AND user_id = ?",
    [calendarId, userId],
  );
  if (!request) return;

  db.withTransactionSync(() => {
    db.runSync(
      "DELETE FROM join_requests WHERE calendar_id = ? AND user_id = ?",
      [calendarId, userId],
    );
    if (approve) {
      db.runSync(
        `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
         VALUES (?,?, 'member', 'active', ?, ?)
         ON CONFLICT (calendar_id, user_id)
         DO UPDATE SET status = 'active'`,
        [calendarId, userId, request.display_name, new Date().toISOString()],
      );
    }
  });

  notifyChanged();
}

// --- app preferences -------------------------------------------------------

/**
 * Device-local display preferences, kept in the meta key/value table.
 *
 * These are not calendar state and never sync: they describe how THIS device
 * draws things. Defaults are expressed at the read site so a missing row means
 * "the default", which is what an upgrade from an older install looks like.
 */
export function getBoolPref(key: string, fallback: boolean): boolean {
  const db = getDb();
  const row = db.getFirstSync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    [`pref:${key}`],
  );
  if (!row) return fallback;
  return row.value === "1";
}

export function setBoolPref(key: string, value: boolean): void {
  const db = getDb();
  db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
    `pref:${key}`,
    value ? "1" : "0",
  ]);
  notifyChanged();
}

/** Countdown beside each agenda day heading. On unless turned off. */
export const showCountdown = (): boolean => getBoolPref("countdown", true);

/**
 * Everything I am part of between two instants, in start order.
 *
 * The week and month views need PAST days too (a month grid that starts empty
 * until today would be a lie), so unlike listAgenda this is not anchored to now.
 */
export function listAgendaBetween(
  fromUtc: string,
  toUtc: string,
): (EventRow & { calendar_name: string })[] {
  return getDb().getAllSync<EventRow & { calendar_name: string }>(
    `SELECT e.*, c.name AS calendar_name
       FROM events e
       JOIN calendars c ON c.calendar_id = e.calendar_id
       JOIN members m ON m.calendar_id = e.calendar_id AND m.user_id = ?
      WHERE m.status = 'active' AND c.status = 'active'
        AND e.start_utc >= ? AND e.start_utc < ?
      ORDER BY e.start_utc`,
    [CURRENT_USER_ID, fromUtc, toUtc],
  );
}

export interface DayRsvpCounts {
  going: number;
  maybe: number;
  not_going: number;
  none: number;
  /** Called off. Counted separately: my answer to it is no longer the point. */
  cancelled: number;
}

/**
 * My answer for every event in a range, tallied per day.
 *
 * The week view needs shape, not detail: how many things are on a day and how I
 * stand on them. Doing it in one query keeps a week of dots to a single read
 * rather than one per event, which matters because the strip redraws on every
 * RSVP.
 *
 * Occurrence is the series default, matching EventRow: recurring events get
 * per-occurrence answers when the series editor lands (§5.5).
 */
export function rsvpCountsByDay(
  fromUtc: string,
  toUtc: string,
): Record<string, DayRsvpCounts> {
  const rows = getDb().getAllSync<{
    start_utc: string;
    event_status: string;
    status: string | null;
  }>(
    `SELECT e.start_utc AS start_utc, e.status AS event_status, r.status AS status
       FROM events e
       JOIN calendars c ON c.calendar_id = e.calendar_id
       JOIN members m ON m.calendar_id = e.calendar_id AND m.user_id = ?
       LEFT JOIN rsvps r
         ON r.event_id = e.event_id AND r.user_id = ? AND r.occurrence = ?
      WHERE m.status = 'active' AND c.status = 'active'
        AND e.start_utc >= ? AND e.start_utc < ?`,
    [CURRENT_USER_ID, CURRENT_USER_ID, SERIES_DEFAULT, fromUtc, toUtc],
  );

  // A plain object, NOT a Map: useQuery compares snapshots by JSON, and every
  // Map serialises to "{}", so a Map here would silently never refresh after an
  // RSVP. Same trap for Set.
  const byDay: Record<string, DayRsvpCounts> = {};
  for (const row of rows) {
    const key = row.start_utc.slice(0, 10);
    const counts = (byDay[key] ??= {
      going: 0,
      maybe: 0,
      not_going: 0,
      none: 0,
      cancelled: 0,
    });
    if (row.event_status === "cancelled") counts.cancelled += 1;
    else if (row.status === "going") counts.going += 1;
    else if (row.status === "maybe") counts.maybe += 1;
    else if (row.status === "not_going") counts.not_going += 1;
    else counts.none += 1;
  }
  return byDay;
}

/**
 * Calendars I am allowed to add an event to.
 *
 * Owners always can; members only where the owner left it open (§8.1). Doing the
 * filter here rather than in the picker means the Add button on the agenda can
 * never offer a destination that would then reject the event.
 */
export function listCalendarsICanPostTo(): (CalendarRow & {
  my_role: "owner" | "member";
})[] {
  return listCalendars().filter(
    (c) => c.my_role === "owner" || c.allow_member_events === 1,
  );
}

// --- editing an event (§8.1) -----------------------------------------------

export interface EventEdits {
  title: string;
  description?: string | null;
  startUtc: string;
  endUtc?: string | null;
  tz: string;
  localWall: string;
  precision: "datetime" | "date" | "tbc";
  locationName?: string | null;
  locationAddress?: string | null;
  ticketsRequired: boolean;
  ticketUrl?: string | null;
  imageKey?: string | null;
}

/**
 * Edit in place, as an owner or as the person who added it.
 *
 * The version moves on every edit and the change is queued, so the sync layer
 * can order this against someone else's concurrent edit rather than having to
 * guess (§5.3). `updated_by` is recorded because a shared calendar that appears
 * to rearrange itself is one nobody trusts.
 *
 * Permission is NOT checked here: the caller knows the membership, and a
 * repository that silently no-ops on a permission failure is how a button ends
 * up doing nothing with no explanation. canEditEvent in @calder/core is the one
 * rule, used by the screens to decide whether to offer the edit at all.
 */
export function updateEvent(eventId: string, edits: EventEdits): void {
  const db = getDb();
  const now = new Date().toISOString();

  const event = db.getFirstSync<{ calendar_id: string }>(
    "SELECT calendar_id FROM events WHERE event_id = ?",
    [eventId],
  );
  if (!event) return;

  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE events SET
         title = ?, description = ?, start_utc = ?, end_utc = ?, tz = ?,
         local_wall = ?, precision = ?, location_name = ?, location_address = ?,
         tickets_required = ?, ticket_url = ?, image_key = ?,
         version = version + 1, updated_by = ?, updated_at = ?,
         sync_state = 'pending'
       WHERE event_id = ?`,
      [
        edits.title.trim(),
        edits.description?.trim() || null,
        edits.startUtc,
        edits.endUtc ?? null,
        edits.tz,
        edits.localWall,
        edits.precision,
        edits.locationName?.trim() || null,
        edits.locationAddress?.trim() || null,
        edits.ticketsRequired ? 1 : 0,
        edits.ticketUrl?.trim() || null,
        edits.imageKey ?? null,
        CURRENT_USER_ID,
        now,
        eventId,
      ],
    );

    db.runSync(
      `INSERT OR REPLACE INTO mutation_queue
         (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?, 'PATCH', ?, ?, ?)`,
      [
        `event-edit:${eventId}`,
        event.calendar_id,
        `/v1/calendars/${event.calendar_id}/events/${eventId}`,
        JSON.stringify(edits),
        now,
      ],
    );
  });

  notifyChanged();
}

/**
 * Call it off, or bring it back.
 *
 * Cancelling is not deleting: the event stays, struck through, because people
 * who had already made plans around it need to see that it is off rather than
 * find a hole where it was (§8.2).
 */
export function setEventCancelled(eventId: string, cancelled: boolean): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.runSync(
    `UPDATE events SET status = ?, version = version + 1,
       updated_by = ?, updated_at = ?, sync_state = 'pending'
     WHERE event_id = ?`,
    [cancelled ? "cancelled" : "active", CURRENT_USER_ID, now, eventId],
  );

  notifyChanged();
}

// --- suggestions (§8.1) ----------------------------------------------------

export interface EventSuggestionRow {
  suggestion_id: string;
  event_id: string;
  calendar_id: string;
  suggested_by: string;
  suggested_by_name: string;
  created_at: string;
  note: string | null;
  changes: string;
  base_version: number;
  status: "pending" | "accepted" | "rejected";
  resolved_at: string | null;
}

/** Only the fields a suggestion is allowed to touch. */
export type SuggestedChanges = Partial<{
  title: string;
  description: string | null;
  start_utc: string;
  end_utc: string | null;
  location_name: string | null;
  location_address: string | null;
}>;

export const SUGGESTABLE_FIELDS = [
  "title",
  "start_utc",
  "end_utc",
  "location_name",
  "location_address",
  "description",
] as const;

export function getSuggestion(suggestionId: string): EventSuggestionRow | null {
  return getDb().getFirstSync<EventSuggestionRow>(
    "SELECT * FROM suggestions WHERE suggestion_id = ?",
    [suggestionId],
  );
}

/**
 * The open suggestion on an event, if there is one.
 *
 * A notification names an event rather than a suggestion, because the inbox is
 * written by the stream fan-out and the suggestion may have been withdrawn by
 * the time it is opened. Resolving it here means a stale tap lands on "nothing
 * to answer" rather than a missing row.
 */
export function pendingSuggestionForEvent(
  eventId: string,
): EventSuggestionRow | null {
  return getDb().getFirstSync<EventSuggestionRow>(
    `SELECT * FROM suggestions
      WHERE event_id = ? AND status = 'pending'
      ORDER BY created_at
      LIMIT 1`,
    [eventId],
  );
}

export function parseChanges(row: EventSuggestionRow): SuggestedChanges {
  try {
    const parsed: unknown = JSON.parse(row.changes);
    if (parsed && typeof parsed === "object") return parsed as SuggestedChanges;
  } catch {
    // A suggestion whose payload will not parse is not worth crashing a screen
    // over: it renders as "no changes" and can still be dismissed.
  }
  return {};
}

/**
 * Accept or reject, in one transaction.
 *
 * Accepting writes ONLY the fields the suggestion carries, so an owner's own
 * edits to other fields survive. The event version moves either way it is
 * touched, which is what the sync layer will use to order this against
 * concurrent edits (§5.3).
 */
export function resolveSuggestion(
  suggestionId: string,
  approve: boolean,
): void {
  const db = getDb();
  const suggestion = getSuggestion(suggestionId);
  if (!suggestion || suggestion.status !== "pending") return;

  const changes = parseChanges(suggestion);
  const now = new Date().toISOString();

  db.withTransactionSync(() => {
    if (approve) {
      const fields = SUGGESTABLE_FIELDS.filter((f) => f in changes);
      if (fields.length > 0) {
        const sets = fields.map((f) => `${f} = ?`);
        const values = fields.map((f) => changes[f] ?? null);

        // local_wall is derived, not suggested: letting it drift from start_utc
        // would show one time in the list and another on the event (§5.5).
        if ("start_utc" in changes && changes.start_utc) {
          sets.push("local_wall = ?");
          values.push(changes.start_utc.slice(0, 19));
        }

        db.runSync(
          `UPDATE events SET ${sets.join(", ")}, version = version + 1,
             sync_state = 'pending'
           WHERE event_id = ?`,
          [...values, suggestion.event_id],
        );
      }
    }

    db.runSync(
      "UPDATE suggestions SET status = ?, resolved_at = ? WHERE suggestion_id = ?",
      [approve ? "accepted" : "rejected", now, suggestionId],
    );

    // The person who suggested it hears back either way. Silence on a rejected
    // suggestion reads as the app having eaten it (§8.1).
    const event = db.getFirstSync<{ title: string }>(
      "SELECT title FROM events WHERE event_id = ?",
      [suggestion.event_id],
    );
    const calendar = db.getFirstSync<{ name: string }>(
      "SELECT name FROM calendars WHERE calendar_id = ?",
      [suggestion.calendar_id],
    );

    db.runSync(
      `INSERT INTO notifications (notification_id, kind, created_at, read_at,
         calendar_id, calendar_name, event_id, event_title, actor_id, actor_name)
       VALUES (?,?,?,NULL,?,?,?,?,?,?)`,
      [
        ulid(),
        approve ? "suggestion_accepted" : "suggestion_rejected",
        now,
        suggestion.calendar_id,
        calendar?.name ?? null,
        suggestion.event_id,
        event?.title ?? null,
        suggestion.suggested_by,
        suggestion.suggested_by_name,
      ],
    );

    // The prompt that brought me here has been answered.
    db.runSync(
      `UPDATE notifications SET read_at = ?
        WHERE kind = 'suggestion_received' AND event_id = ? AND read_at IS NULL`,
      [now, suggestion.event_id],
    );
  });

  notifyChanged();
}

// --- my profile ------------------------------------------------------------

export interface Profile {
  userId: string;
  handle: string;
  displayName: string;
  email: string | null;
  /** Local file URI until there is somewhere to upload it (§3.4). */
  avatar: string | null;
  /** Who can find me by handle, name or email when they search (§7.2). */
  discoverable: boolean;
  /** What a new friend gets by default, before I change it for them (§7.4). */
  defaultGrants: FriendGrants;
}

/**
 * Name and handle live in the directory, alongside everyone else's: they are
 * what other people see, and keeping my own copy somewhere separate is how a
 * rename ends up applied in one place and not the other. Avatar and the privacy
 * choices are device-local prefs for now, because nothing syncs yet.
 */
export function getProfile(): Profile {
  const db = getDb();
  const row = db.getFirstSync<{
    user_id: string;
    handle: string;
    display_name: string;
    email: string | null;
  }>("SELECT * FROM directory WHERE user_id = ?", [CURRENT_USER_ID]);

  const avatar = db.getFirstSync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'profile:avatar'",
  );

  const grants = db.getFirstSync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'profile:default_grants'",
  );

  return {
    userId: CURRENT_USER_ID,
    handle: row?.handle ?? "you",
    displayName: row?.display_name ?? "You",
    email: row?.email ?? null,
    avatar: avatar?.value ?? null,
    discoverable: getBoolPref("discoverable", true),
    defaultGrants: (grants?.value as FriendGrants) ?? "none",
  };
}

export function updateProfile(changes: {
  displayName?: string;
  handle?: string;
  avatar?: string | null;
  discoverable?: boolean;
  defaultGrants?: FriendGrants;
}): void {
  const db = getDb();

  db.withTransactionSync(() => {
    if (changes.displayName !== undefined || changes.handle !== undefined) {
      const current = db.getFirstSync<{ handle: string; display_name: string }>(
        "SELECT handle, display_name FROM directory WHERE user_id = ?",
        [CURRENT_USER_ID],
      );
      db.runSync(
        `INSERT INTO directory (user_id, handle, display_name, email)
         VALUES (?,?,?,NULL)
         ON CONFLICT (user_id) DO UPDATE SET handle = ?, display_name = ?`,
        [
          CURRENT_USER_ID,
          changes.handle ?? current?.handle ?? "you",
          changes.displayName ?? current?.display_name ?? "You",
          changes.handle ?? current?.handle ?? "you",
          changes.displayName ?? current?.display_name ?? "You",
        ],
      );

      // My name appears against every membership as well: it is denormalised
      // there so a calendar can be listed without reading the directory (§4.3).
      // Renaming in one place only is how someone ends up with two names.
      if (changes.displayName !== undefined) {
        db.runSync("UPDATE members SET display_name = ? WHERE user_id = ?", [
          changes.displayName,
          CURRENT_USER_ID,
        ]);
      }
    }

    if (changes.avatar !== undefined) {
      if (changes.avatar === null) {
        db.runSync("DELETE FROM meta WHERE key = 'profile:avatar'");
      } else {
        db.runSync(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('profile:avatar', ?)",
          [changes.avatar],
        );
      }
    }

    if (changes.defaultGrants !== undefined) {
      db.runSync(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('profile:default_grants', ?)",
        [changes.defaultGrants],
      );
    }
  });

  if (changes.discoverable !== undefined) {
    setBoolPref("discoverable", changes.discoverable);
  }

  notifyChanged();
}

/** Is this handle free? Mine does not count as taken. */
export function handleAvailable(handle: string): boolean {
  const row = getDb().getFirstSync<{ user_id: string }>(
    "SELECT user_id FROM directory WHERE handle = ? COLLATE NOCASE",
    [handle],
  );
  return row === null || row.user_id === CURRENT_USER_ID;
}

export interface ProfileFootprint {
  calendars: number;
  ownedCalendars: number;
  soleOwnerOf: string[];
  events: number;
  friends: number;
}

/**
 * What deleting the account would touch.
 *
 * Shown before the confirmation rather than after, because "3 calendars where
 * you are the only owner" is the fact that changes someone's mind, and finding
 * out afterwards is finding out too late (§8.5).
 */
export function profileFootprint(): ProfileFootprint {
  const db = getDb();

  const one = (sql: string, args: unknown[] = []): number =>
    db.getFirstSync<{ n: number }>(sql, args as never)?.n ?? 0;

  const soleOwner = db.getAllSync<{ name: string }>(
    `SELECT c.name AS name
       FROM calendars c
       JOIN members me ON me.calendar_id = c.calendar_id
        AND me.user_id = ? AND me.role = 'owner' AND me.status = 'active'
      WHERE c.status = 'active'
        AND (SELECT COUNT(*) FROM members o
              WHERE o.calendar_id = c.calendar_id
                AND o.role = 'owner' AND o.status = 'active') = 1
      ORDER BY c.name`,
    [CURRENT_USER_ID],
  );

  return {
    calendars: one(
      "SELECT COUNT(*) AS n FROM members WHERE user_id = ? AND status = 'active'",
      [CURRENT_USER_ID],
    ),
    ownedCalendars: one(
      "SELECT COUNT(*) AS n FROM members WHERE user_id = ? AND role = 'owner' AND status = 'active'",
      [CURRENT_USER_ID],
    ),
    soleOwnerOf: soleOwner.map((r) => r.name),
    events: one("SELECT COUNT(*) AS n FROM events WHERE created_by = ?", [
      CURRENT_USER_ID,
    ]),
    friends: one(
      "SELECT COUNT(*) AS n FROM friends WHERE status = 'accepted'",
    ),
  };
}

/**
 * Delete the account, locally.
 *
 * Real deletion is a server job and is a PSEUDONYMISATION, not a purge (§8.5):
 * events someone added stay, attributed to "A former member", because deleting
 * them would tear holes in other people's calendars. This local version wipes
 * the device and returns to a fresh state, which is the honest prototype of it.
 */
export function deleteMyProfile(): void {
  const db = getDb();

  db.withTransactionSync(() => {
    for (const table of [
      "availability",
      "rsvps",
      "suggestions",
      "events",
      "members",
      "calendars",
      "notifications",
      "pending_invites",
      "friends",
      "directory",
      "mutation_queue",
      "sent_invites",
      "invite_links",
      "join_requests",
      "meta",
    ]) {
      db.runSync(`DELETE FROM ${table}`);
    }
  });

  notifyChanged();
}

/**
 * Members and RSVPs across several calendars at once, for the agenda, where a
 * day's events do not all belong to the same calendar.
 *
 * Members are deduplicated by user: the same person can be in two of your
 * calendars, and counting them twice would inflate every "going" tally on a
 * screen that mixes calendars together. Nobody can RSVP to an event outside
 * their own calendar, so the union is safe to resolve against.
 */
export function listMembersForCalendars(
  calendarIds: readonly string[],
): MemberRow[] {
  if (calendarIds.length === 0) return [];
  const marks = calendarIds.map(() => "?").join(",");

  return getDb().getAllSync<MemberRow>(
    `SELECT user_id, role, status, display_name
       FROM members
      WHERE calendar_id IN (${marks}) AND status = 'active'
      GROUP BY user_id`,
    [...calendarIds],
  );
}

export function listRsvpsForCalendars(
  calendarIds: readonly string[],
): RsvpRow[] {
  if (calendarIds.length === 0) return [];
  const marks = calendarIds.map(() => "?").join(",");

  return getDb().getAllSync<RsvpRow>(
    `SELECT * FROM rsvps WHERE calendar_id IN (${marks})`,
    [...calendarIds],
  );
}

// --- deciding when (§8.1) ---------------------------------------------------

export interface SlotRow {
  slot_id: string;
  event_id: string;
  calendar_id: string;
  start_utc: string;
  end_utc: string | null;
  tz: string;
  local_wall: string;
  precision: "datetime" | "date";
  proposed_by: string;
  proposed_by_name: string;
  created_at: string;
  sync_state: "synced" | "pending" | "failed";
}

export interface SlotVoteRow {
  slot_id: string;
  event_id: string;
  user_id: string;
  response: SlotResponse;
  responded_at: string;
}

export const listSlots = (eventId: string): SlotRow[] =>
  getDb().getAllSync<SlotRow>(
    "SELECT * FROM event_slots WHERE event_id = ? ORDER BY start_utc",
    [eventId],
  );

export const listSlotVotes = (eventId: string): SlotVoteRow[] =>
  getDb().getAllSync<SlotVoteRow>("SELECT * FROM slot_votes WHERE event_id = ?", [
    eventId,
  ]);

/**
 * Start asking rather than deciding.
 *
 * The event keeps whatever time it had: an event with no time at all cannot be
 * placed in a list, and a poll that hides the thing being planned is worse than
 * one with a provisional date on it. The date shows as provisional until a slot
 * is chosen.
 */
export function startPoll(eventId: string, mode: SchedulingMode): void {
  getDb().runSync(
    `UPDATE events SET scheduling_mode = ?, version = version + 1,
       updated_by = ?, updated_at = ?, sync_state = 'pending'
     WHERE event_id = ?`,
    [mode, CURRENT_USER_ID, new Date().toISOString(), eventId],
  );
  notifyChanged();
}

export interface NewSlot {
  startUtc: string;
  endUtc?: string | null;
  tz: string;
  localWall: string;
  precision?: "datetime" | "date";
}

/**
 * Add a candidate time.
 *
 * Duplicates are refused rather than merged: two people proposing the same
 * evening should land on one row that both can answer, not two identical rows
 * that split the vote between them. Returns the existing slot's id in that case,
 * so the caller can point at it instead.
 */
export function proposeSlot(eventId: string, input: NewSlot): string {
  const db = getDb();

  const event = db.getFirstSync<{ calendar_id: string }>(
    "SELECT calendar_id FROM events WHERE event_id = ?",
    [eventId],
  );
  if (!event) return "";

  const existing = db.getFirstSync<{ slot_id: string }>(
    "SELECT slot_id FROM event_slots WHERE event_id = ? AND start_utc = ?",
    [eventId, input.startUtc],
  );
  if (existing) return existing.slot_id;

  const me = db.getFirstSync<{ display_name: string }>(
    "SELECT display_name FROM members WHERE calendar_id = ? AND user_id = ?",
    [event.calendar_id, CURRENT_USER_ID],
  );

  const slotId = ulid();
  db.runSync(
    `INSERT INTO event_slots (slot_id, event_id, calendar_id, start_utc, end_utc,
       tz, local_wall, precision, proposed_by, proposed_by_name, created_at, sync_state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending')`,
    [
      slotId,
      eventId,
      event.calendar_id,
      input.startUtc,
      input.endUtc ?? null,
      input.tz,
      input.localWall,
      input.precision ?? "datetime",
      CURRENT_USER_ID,
      me?.display_name ?? "You",
      new Date().toISOString(),
    ],
  );

  notifyChanged();
  return slotId;
}

/** Withdraw a slot. Its votes go with it, which the foreign key handles. */
export function removeSlot(slotId: string): void {
  getDb().runSync("DELETE FROM event_slots WHERE slot_id = ?", [slotId]);
  notifyChanged();
}

/**
 * Answer one slot, or clear the answer by passing null.
 *
 * Clearing matters as much as answering: "I have not decided" is a real state,
 * and someone who mis-taps "no" on a date they could actually make needs a way
 * back that is not "say yes and hope".
 */
export function setSlotVote(
  eventId: string,
  slotId: string,
  response: SlotResponse | null,
): void {
  const db = getDb();

  if (response === null) {
    db.runSync("DELETE FROM slot_votes WHERE slot_id = ? AND user_id = ?", [
      slotId,
      CURRENT_USER_ID,
    ]);
  } else {
    db.runSync(
      `INSERT INTO slot_votes (slot_id, event_id, user_id, response, responded_at, sync_state)
       VALUES (?,?,?,?,?, 'pending')
       ON CONFLICT (slot_id, user_id)
       DO UPDATE SET response = ?, responded_at = ?, sync_state = 'pending'`,
      [
        slotId,
        eventId,
        CURRENT_USER_ID,
        response,
        new Date().toISOString(),
        response,
        new Date().toISOString(),
      ],
    );
  }

  notifyChanged();
}

/**
 * Settle it: this slot becomes the event's time and the poll closes.
 *
 * The slots and their votes are KEPT. "Why is it on the Thursday" is a question
 * people ask afterwards, and the answer is the poll; deleting it turns a
 * decision everyone took part in into one that seems to have been imposed.
 */
export function chooseSlot(eventId: string, slotId: string): void {
  const db = getDb();
  const slot = db.getFirstSync<SlotRow>(
    "SELECT * FROM event_slots WHERE slot_id = ?",
    [slotId],
  );
  if (!slot) return;

  const now = new Date().toISOString();

  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE events SET start_utc = ?, end_utc = ?, tz = ?, local_wall = ?,
         precision = ?, scheduling_mode = 'fixed', version = version + 1,
         updated_by = ?, updated_at = ?, sync_state = 'pending'
       WHERE event_id = ?`,
      [
        slot.start_utc,
        slot.end_utc,
        slot.tz,
        slot.local_wall,
        slot.precision,
        CURRENT_USER_ID,
        now,
        eventId,
      ],
    );

    // Everyone who said they could make it is now going: they have already
    // answered the only question an RSVP asks, and making them answer it twice
    // is how a settled date collects no replies.
    const yes = db.getAllSync<{ user_id: string }>(
      "SELECT user_id FROM slot_votes WHERE slot_id = ? AND response = 'yes'",
      [slotId],
    );

    for (const { user_id } of yes) {
      db.runSync(
        `INSERT INTO rsvps (event_id, occurrence, user_id, calendar_id, status, responded_at, sync_state)
         VALUES (?, '-', ?, ?, 'going', ?, 'pending')
         ON CONFLICT (event_id, occurrence, user_id) DO NOTHING`,
        [eventId, user_id, slot.calendar_id, now],
      );
    }
  });

  notifyChanged();
}

/**
 * Every place already used across my calendars, most recent first.
 *
 * People go back to the same dozen places, so this is the shortlist a location
 * picker should offer before asking anyone to type. Scoped to calendars I am in,
 * because it is a convenience built from my own history and not a directory of
 * other people's haunts.
 */
export function recentPlaces(limit = 40): string[] {
  return getDb()
    .getAllSync<{ location_name: string }>(
      `SELECT e.location_name AS location_name
         FROM events e
         JOIN members m ON m.calendar_id = e.calendar_id AND m.user_id = ?
        WHERE m.status = 'active'
          AND e.location_name IS NOT NULL
          AND TRIM(e.location_name) != ''
        GROUP BY LOWER(e.location_name)
        ORDER BY MAX(e.start_utc) DESC
        LIMIT ?`,
      [CURRENT_USER_ID, limit],
    )
    .map((r) => r.location_name);
}

// --- a friend's page (§7.3, §7.4) ------------------------------------------
//
// One person, everything about the relationship: what each of us can see of the
// other, where we already overlap, when we are both free, and which of my
// private calendars they are missing from. Scattered across three screens this
// was four taps and a guess; together it is the page you would draw if you were
// asked "what is my relationship with this person in this app".

export interface FriendProfileRow extends PersonRow {
  /** What THEY let ME see. The mirror of `grants`, and not implied by it. */
  shares: FriendGrants | null;
  since: string | null;
}

export function friendProfile(userId: string): FriendProfileRow | null {
  return getDb().getFirstSync<FriendProfileRow>(
    `SELECT d.user_id, d.handle, d.display_name, d.email,
            f.status, f.grants, f.shares, f.since
       FROM directory d
       LEFT JOIN friends f ON f.user_id = d.user_id
      WHERE d.user_id = ?`,
    [userId],
  );
}

/**
 * Calendars we are both active members of.
 *
 * The honest measure of a connection in this app: not a follower count, but the
 * things you are actually both part of.
 */
export function sharedCalendars(userId: string): (CalendarRow & {
  my_role: "owner" | "member";
})[] {
  return getDb().getAllSync<CalendarRow & { my_role: "owner" | "member" }>(
    `SELECT c.*, me.role AS my_role
       FROM calendars c
       JOIN members me ON me.calendar_id = c.calendar_id
       JOIN members them ON them.calendar_id = c.calendar_id
      WHERE me.user_id = ? AND me.status = 'active'
        AND them.user_id = ? AND them.status = 'active'
        AND c.status = 'active'
      ORDER BY c.mode, c.name`,
    [CURRENT_USER_ID, userId],
  );
}

/**
 * My private calendars this person is not already part of.
 *
 * Private calendars are the ones worth offering here: a trip has its own invite
 * flow and a link, whereas "you and me" calendars are exactly the thing you
 * want to start from somebody's page. Anything they have already been asked to
 * join is excluded, because inviting twice is how an invite becomes noise.
 */
export function myPrivateCalendarsWithout(userId: string): CalendarRow[] {
  return getDb().getAllSync<CalendarRow>(
    `SELECT c.*
       FROM calendars c
       JOIN members me ON me.calendar_id = c.calendar_id
      WHERE me.user_id = ? AND me.role = 'owner' AND me.status = 'active'
        AND c.is_private = 1
        AND c.status = 'active'
        -- Only ACTIVE membership excludes a calendar: somebody who left, or was
        -- removed, is exactly the person you might want to ask back.
        AND NOT EXISTS (
              SELECT 1 FROM members m
               WHERE m.calendar_id = c.calendar_id
                 AND m.user_id = ?
                 AND m.status = 'active')
        AND NOT EXISTS (
              SELECT 1 FROM sent_invites s
               WHERE s.calendar_id = c.calendar_id AND s.user_id = ?)
      ORDER BY c.name`,
    [CURRENT_USER_ID, userId, userId],
  );
}

/**
 * When somebody is spoken for, between two instants.
 *
 * Busy means "has said yes to something", plus anything they put in a calendar
 * themselves — a plan you added to your own calendar is a plan, whether or not
 * you also ticked Going on it. Maybe is deliberately NOT busy: an undecided
 * evening is exactly the kind of evening a catch-up can win.
 *
 * An event with no stated end gets an hour, which is a guess; it is the same
 * guess the landscape hour grid makes, and erring towards busy means the worst
 * case is a suggestion the two of them decline rather than a double booking.
 */
export function busyBetween(
  userIds: readonly string[],
  fromUtc: string,
  toUtc: string,
): { start: string; end: string }[] {
  if (userIds.length === 0) return [];
  const marks = userIds.map(() => "?").join(",");

  return getDb().getAllSync<{ start: string; end: string }>(
    `SELECT e.start_utc AS start,
            COALESCE(e.end_utc, strftime('%Y-%m-%dT%H:%M:%fZ', e.start_utc, '+1 hour')) AS end
       FROM events e
       JOIN members m ON m.calendar_id = e.calendar_id AND m.status = 'active'
       LEFT JOIN rsvps r
              ON r.event_id = e.event_id
             AND r.occurrence = '-'
             AND r.user_id = m.user_id
      WHERE m.user_id IN (${marks})
        AND e.status = 'active'
        AND e.precision != 'tbc'
        AND e.start_utc < ?
        AND COALESCE(e.end_utc, strftime('%Y-%m-%dT%H:%M:%fZ', e.start_utc, '+1 hour')) > ?
        AND (r.status = 'going' OR e.created_by = m.user_id)
      ORDER BY e.start_utc`,
    [...userIds, toUtc, fromUtc],
  );
}

// --- appearance (device-local) ---------------------------------------------

/**
 * Light, dark, or whatever the phone says.
 *
 * Stored, like the other display preferences, in `meta`: it is a fact about
 * this device rather than about the person, and someone who uses the app on a
 * phone and a tablet is entitled to a different answer on each.
 *
 * The absence of a row is meaningful — it means the person has never been asked
 * — so this returns null rather than defaulting, and the caller decides whether
 * that means "ask them" or "follow the phone".
 */
export function getAppearance(): Appearance | null {
  const row = getDb().getFirstSync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'pref:appearance'",
  );
  if (!row) return null;
  return row.value === "light" || row.value === "dark" || row.value === "system"
    ? row.value
    : null;
}

export function setAppearance(value: Appearance): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('pref:appearance', ?)",
    [value],
  );
  notifyChanged();
}

// --- inviting one person to one thing (§8.1) ---------------------------------
//
// The third way to make a plan with somebody, after a shared calendar and a
// poll: pick a time and ask them. It is deliberately not an RSVP on an event
// they can see, because the event is in YOUR calendar, which they cannot; the
// invite carries a copy of what matters, and saying yes puts a copy of it in
// theirs. Two calendars, two events, one link between them.

export interface EventInviteRow {
  invite_id: string;
  event_id: string;
  from_user: string;
  from_name: string;
  to_user: string;
  title: string;
  start_utc: string;
  end_utc: string | null;
  tz: string;
  local_wall: string;
  precision: "datetime" | "date" | "tbc";
  location_name: string | null;
  status: "pending" | "accepted" | "declined";
  sent_at: string;
  answered_at: string | null;
  accepted_event_id: string | null;
}

export function sendEventInvite(eventId: string, toUser: string): string {
  const event = getEvent(eventId);
  if (!event) throw new Error(`no such event ${eventId}`);
  const me = getProfile();
  const inviteId = ulid();

  getDb().runSync(
    `INSERT INTO event_invites
       (invite_id, event_id, from_user, from_name, to_user, title, start_utc, end_utc,
        tz, local_wall, precision, location_name, status, sent_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`,
    [
      inviteId,
      eventId,
      CURRENT_USER_ID,
      me.displayName,
      toUser,
      event.title,
      event.start_utc,
      event.end_utc,
      event.tz,
      event.local_wall,
      event.precision,
      event.location_name,
      new Date().toISOString(),
    ],
  );
  notifyChanged();
  return inviteId;
}

/** Invitations waiting on ME, soonest first. */
export function listEventInvitesForMe(): EventInviteRow[] {
  return getDb().getAllSync<EventInviteRow>(
    `SELECT * FROM event_invites
      WHERE to_user = ? AND status = 'pending'
      ORDER BY start_utc`,
    [CURRENT_USER_ID],
  );
}

/** Who I asked to one of my events, and what they said. */
export function listInvitesSentForEvent(
  eventId: string,
): (EventInviteRow & { to_name: string })[] {
  return getDb().getAllSync<EventInviteRow & { to_name: string }>(
    `SELECT i.*, COALESCE(d.display_name, i.to_user) AS to_name
       FROM event_invites i
       LEFT JOIN directory d ON d.user_id = i.to_user
      WHERE i.event_id = ? AND i.from_user = ?
      ORDER BY i.sent_at`,
    [eventId, CURRENT_USER_ID],
  );
}

/**
 * Saying yes creates the event in my own calendar; saying no records the answer
 * and creates nothing. Either way the invite stays, because "Maya asked and I
 * said no" is a fact the sender is owed and a fact I might want to revisit.
 */
export function answerEventInvite(inviteId: string, accept: boolean): void {
  const db = getDb();
  const invite = db.getFirstSync<EventInviteRow>(
    "SELECT * FROM event_invites WHERE invite_id = ?",
    [inviteId],
  );
  if (!invite || invite.status !== "pending") return;

  const now = new Date().toISOString();
  // createEvent runs its own transaction, and expo-sqlite does not nest them
  // (BEGIN inside BEGIN), so the copy is made first and the answer recorded
  // after. If the second write failed the worst case is an accepted event
  // whose invite still reads pending, which the next tap corrects.
  let copyId: string | null = null;
  if (accept) {
    copyId = createEvent(OWN_PLANS_ID, {
      title: invite.title,
      startUtc: invite.start_utc,
      endUtc: invite.end_utc,
      tz: invite.tz,
      localWall: invite.local_wall,
      precision: invite.precision,
      locationName: invite.location_name,
      ticketsRequired: false,
      ticketUrl: null,
      imageKey: null,
      description: `With ${invite.from_name}.`,
    });
  }
  db.runSync(
    `UPDATE event_invites
        SET status = ?, answered_at = ?, accepted_event_id = ?
      WHERE invite_id = ?`,
    [accept ? "accepted" : "declined", now, copyId, inviteId],
  );
  notifyChanged();
}

// --- undoing things (§8.4) ----------------------------------------------------
//
// The reverse direction. Every one of these is a local write that lands at once
// and queues for the server, exactly like creating; the difference is only in
// what the queued mutation says.

/**
 * Remove an event for good.
 *
 * A hard delete locally, with everything hanging off it: answers, poll slots,
 * votes, suggestions, and any invitations it was the subject of. The server
 * keeps its own tombstones (§8.4); what the phone keeps is the mutation that
 * asks it to.
 */
export function deleteEvent(eventId: string): void {
  const db = getDb();
  const event = getEvent(eventId);
  if (!event) return;
  const now = new Date().toISOString();

  db.withTransactionSync(() => {
    for (const table of ["rsvps", "slot_votes", "event_slots", "suggestions", "event_invites"]) {
      db.runSync(`DELETE FROM ${table} WHERE event_id = ?`, [eventId]);
    }
    db.runSync("DELETE FROM events WHERE event_id = ?", [eventId]);
    db.runSync(
      `INSERT OR REPLACE INTO mutation_queue (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?, 'DELETE', ?, '{}', ?)`,
      [
        `event:${eventId}:delete`,
        event.calendar_id,
        `/v1/calendars/${event.calendar_id}/events/${eventId}`,
        now,
      ],
    );
  });
  notifyChanged();
}

/** How many active owners, for the last-owner rule. */
export function ownerCount(calendarId: string): number {
  return (
    getDb().getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM members
        WHERE calendar_id = ? AND role = 'owner' AND status = 'active'`,
      [calendarId],
    )?.n ?? 0
  );
}

/**
 * Delete a calendar, for everyone in it.
 *
 * A status change rather than a row deletion: every list already filters on
 * status = 'active', and keeping the row means a departed calendar's events can
 * still be reasoned about until the server confirms the tombstone. Its
 * invitations and links are withdrawn at the same time, because a link into a
 * deleted calendar is a door painted on a wall.
 */
export function deleteCalendar(calendarId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync("UPDATE calendars SET status = 'deleted' WHERE calendar_id = ?", [calendarId]);
    db.runSync("DELETE FROM sent_invites WHERE calendar_id = ?", [calendarId]);
    db.runSync("DELETE FROM invite_links WHERE calendar_id = ?", [calendarId]);
    db.runSync("DELETE FROM join_requests WHERE calendar_id = ?", [calendarId]);
    db.runSync(
      `INSERT OR REPLACE INTO mutation_queue (mutation_id, calendar_id, method, path, body, queued_at)
       VALUES (?,?, 'DELETE', ?, '{}', ?)`,
      [`calendar:${calendarId}:delete`, calendarId, `/v1/calendars/${calendarId}`, now],
    );
  });
  notifyChanged();
}

// --- who am I (alpha, local-only) -------------------------------------------
//
// There is no sign-in yet, so the first open asks for a name and a handle and
// keeps them on the phone. Without this every tester is the same person with
// the same handle, and nothing social can be tested at all.

/**
 * Which way in this person chose, for the day accounts are real and for the
 * Profile screen to say. Recorded even in the alpha, where it selects nothing:
 * a tester who picked Apple and later finds the app asking for a password has
 * been told something that was not true.
 */
export function setAuthProvider(provider: string): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('auth:provider', ?)",
    [provider],
  );
  notifyChanged();
}

export function getAuthProvider(): string | null {
  return (
    getDb().getFirstSync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'auth:provider'",
    )?.value ?? null
  );
}

/**
 * Put the first run back, without touching a single calendar.
 *
 * Alpha only, and the reason it exists is that the first run is the thing most
 * worth testing and the hardest to get back to: without this, seeing it again
 * means deleting the app, which also deletes everything a tester has been
 * asked to try.
 */
export function replayOnboarding(): void {
  const db = getDb();
  db.withTransactionSync(() => {
    for (const key of ["identity_set", "pref:appearance", "auth:provider"]) {
      db.runSync("DELETE FROM meta WHERE key = ?", [key]);
    }
  });
  notifyChanged();
}

export function identityComplete(): boolean {
  return (
    getDb().getFirstSync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'identity_set'",
    )?.value === "1"
  );
}

/**
 * Name and handle, chosen once. Also stamps the name onto every membership
 * row this person already has (their own plans was created before they were
 * asked), so nothing anywhere still says "You".
 */
export function setIdentity(displayName: string, handle: string): void {
  const db = getDb();
  const name = displayName.trim();
  const tag = normaliseHandle(handle);
  // The directory upsert is written out here rather than through updateProfile:
  // expo-sqlite's withTransactionSync is BEGIN/COMMIT, not a savepoint, so a
  // transaction inside a transaction commits the outer one early and the outer
  // COMMIT then fails with "no transaction is active". One level, always.
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO directory (user_id, handle, display_name, email)
       VALUES (?,?,?,NULL)
       ON CONFLICT (user_id) DO UPDATE SET handle = excluded.handle,
                                          display_name = excluded.display_name`,
      [CURRENT_USER_ID, tag, name],
    );
    db.runSync("UPDATE members SET display_name = ? WHERE user_id = ?", [name, CURRENT_USER_ID]);
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('identity_set', '1')");
  });
  notifyChanged();
}

/** Lower case, letters, digits, dots and underscores, no leading sigil. */
export function normaliseHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^[&@]+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 24);
}

/** A first guess at a handle from a name: "Maya Okonkwo" -> "maya". */
export function suggestHandle(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  return normaliseHandle(first);
}

// --- example data (alpha) ---------------------------------------------------

export function examplesLoaded(): boolean {
  return fixturesWanted(getDb());
}

/** Pull in every example calendar, person and event. */
export function loadExampleData(): void {
  loadFixtures(getDb());
  notifyChanged();
}

/**
 * Wipe every calendar, event, person and answer, keeping who you are and how
 * the app looks. Your own plans is recreated empty, because it is the one
 * calendar that must always exist.
 */
export function clearAllData(): void {
  const db = getDb();
  db.withTransactionSync(() => {
    for (const table of [
      "availability", "rsvps", "slot_votes", "event_slots", "suggestions",
      "event_invites", "events", "members", "calendars", "notifications",
      "pending_invites", "friends", "mutation_queue", "sent_invites",
      "invite_links", "join_requests",
    ]) {
      db.runSync(`DELETE FROM ${table}`);
    }
    // Everyone but me: my own directory row is my identity, not example data.
    db.runSync("DELETE FROM directory WHERE user_id != ?", [CURRENT_USER_ID]);
    // See clearFixtures in client.ts for why only the inward links go.
    db.runSync("DELETE FROM device_links WHERE direction = 'in'");
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('fixtures', '0')");
  });
  ensureOwnPlans(db);
  notifyChanged();
}

// --- the phone's own calendar (§5.7) -------------------------------------------
//
// Everything here is bookkeeping around a copy that lives somewhere this app
// does not control. The actual talking to iOS and Android is in
// src/lib/deviceCalendar.ts; what follows is only what has to survive a
// restart, plus the query that decides what is eligible to go out at all.

/** Every copy made in one direction, in the shape @calder/core plans against. */
export function listDeviceLinks(direction: SyncDirection): SyncLink[] {
  return getDb()
    .getAllSync<{
      event_id: string;
      device_event_id: string;
      device_calendar_id: string;
      hash: string | null;
    }>(
      `SELECT event_id, device_event_id, device_calendar_id, hash
         FROM device_links WHERE direction = ?`,
      [direction],
    )
    .map((r) => ({
      eventId: r.event_id,
      deviceEventId: r.device_event_id,
      deviceCalendarId: r.device_calendar_id,
      hash: r.hash,
    }));
}

/**
 * Write down what an export actually did.
 *
 * One transaction for the whole result, because these rows only have value as
 * a set: a half-written batch would leave copies on the phone with no link to
 * them, and the next run would make a second copy of every one. The write
 * happens AFTER the phone has been touched rather than before, so a link never
 * claims a copy exists that does not.
 *
 * Removals and vanishings are treated identically here even though they mean
 * different things above: one is a copy we deleted, the other a copy somebody
 * else deleted first. Either way it is gone, and remembering it is the only
 * mistake available.
 */
export function commitExport(
  result: {
    created: readonly { eventId: string; deviceEventId: string }[];
    updated: readonly { eventId: string; deviceEventId: string }[];
    removed: readonly string[];
    vanished: readonly string[];
  },
  deviceCalendarId: string,
  events: readonly ExportableEvent[],
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const hashes = new Map(events.map((e) => [e.eventId, syncHash(e)]));

  db.withTransactionSync(() => {
    for (const made of [...result.created, ...result.updated]) {
      db.runSync(
        `INSERT OR REPLACE INTO device_links
           (event_id, device_event_id, device_calendar_id, direction, hash, linked_at)
         VALUES (?,?,?,'out',?,?)`,
        [
          made.eventId,
          made.deviceEventId,
          deviceCalendarId,
          hashes.get(made.eventId) ?? null,
          now,
        ],
      );
    }
    for (const gone of [...result.removed, ...result.vanished]) {
      db.runSync(
        "DELETE FROM device_links WHERE direction = 'out' AND device_event_id = ?",
        [gone],
      );
    }
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('sync:last', ?)", [now]);
  });

  notifyChanged();
}

/** Forget a copy, once it is gone from the phone (or was never really there). */
export function forgetDeviceLink(direction: SyncDirection, deviceEventId: string): void {
  getDb().runSync(
    "DELETE FROM device_links WHERE direction = ? AND device_event_id = ?",
    [direction, deviceEventId],
  );
  notifyChanged();
}

/**
 * The events here that came FROM the phone.
 *
 * An array rather than a Set because useQuery compares snapshots with
 * JSON.stringify and a Set serialises to `{}`; callers build the Set.
 */
export function importedEventIds(): string[] {
  return getDb()
    .getAllSync<{ event_id: string }>(
      "SELECT event_id FROM device_links WHERE direction = 'in'",
    )
    .map((r) => r.event_id);
}

/**
 * What could be copied out to the phone.
 *
 * Cancelled events are included rather than filtered here, because a cancelled
 * event with an existing copy has to produce a removal: dropping it from this
 * query would leave a dinner nobody is going to sitting on somebody's work
 * calendar with no way to reach it. planExport decides; this only supplies.
 */
export function exportableEvents(): ExportableEvent[] {
  return getDb()
    .getAllSync<{
      event_id: string;
      calendar_id: string;
      title: string;
      start_utc: string;
      end_utc: string | null;
      status: "active" | "cancelled";
      precision: "datetime" | "date" | "tbc";
      updated_at: string | null;
    }>(
      `SELECT e.event_id, e.calendar_id, e.title, e.start_utc, e.end_utc,
              e.status, e.precision, e.updated_at
         FROM events e
         JOIN members m ON m.calendar_id = e.calendar_id
        WHERE m.user_id = ? AND m.status = 'active'
        ORDER BY e.start_utc`,
      [CURRENT_USER_ID],
    )
    .map((r) => ({
      eventId: r.event_id,
      calendarId: r.calendar_id,
      title: r.title,
      startUtc: r.start_utc,
      endUtc: r.end_utc,
      status: r.status,
      precision: r.precision,
      updatedAt: r.updated_at,
    }));
}

/**
 * How many people are in each calendar, counting yourself.
 *
 * A plain object rather than a Map: useQuery compares snapshots with
 * JSON.stringify, and a Map serialises to `{}`, so every result would look
 * identical to the last one and the screen would never update.
 */
export function memberCounts(): Record<string, number> {
  const rows = getDb().getAllSync<{ calendar_id: string; n: number }>(
    `SELECT calendar_id, COUNT(*) AS n FROM members
      WHERE status = 'active' GROUP BY calendar_id`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.calendar_id] = r.n;
  return out;
}

/** The name of the calendar each exportable event belongs to, for grouping. */
export function calendarNames(): Record<string, string> {
  const rows = getDb().getAllSync<{ calendar_id: string; name: string }>(
    "SELECT calendar_id, name FROM calendars",
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.calendar_id] = r.name;
  return out;
}

export function getSyncPrefs(): SyncPrefs {
  const row = getDb().getFirstSync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'sync:prefs'",
  );
  if (!row) return DEFAULT_SYNC_PREFS;
  try {
    // Spread over the defaults rather than trusting the stored object whole: a
    // preference added in a later version must not come back undefined on a
    // phone that saved this row before it existed.
    return { ...DEFAULT_SYNC_PREFS, ...(JSON.parse(row.value) as Partial<SyncPrefs>) };
  } catch {
    return DEFAULT_SYNC_PREFS;
  }
}

export function setSyncPrefs(prefs: SyncPrefs): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('sync:prefs', ?)",
    [JSON.stringify(prefs)],
  );
  notifyChanged();
}

/** When a sync last actually ran, for the line under the button. */
export function lastSyncAt(): string | null {
  return (
    getDb().getFirstSync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'sync:last'",
    )?.value ?? null
  );
}

export function markSyncRun(): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('sync:last', ?)",
    [new Date().toISOString()],
  );
}

export interface ImportedEvent {
  readonly deviceEventId: string;
  readonly deviceCalendarId: string;
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string | null;
  readonly localWall: string;
  readonly tz: string;
  readonly allDay: boolean;
}

/**
 * Bring events in from the phone, as one transaction.
 *
 * One transaction for the whole batch, not one per event, and the links are
 * written beside the events they describe: a crash halfway through a hundred
 * imports must not leave events with no link, because the next run would then
 * import every one of them again.
 *
 * Imported events are marked 'synced' rather than 'pending'. They did not
 * originate here and there is nothing to push: queueing them would send
 * somebody's private work meetings to the server the day sync is switched on,
 * which is the opposite of what importing them was for.
 */
export function importDeviceEvents(
  calendarId: string,
  events: readonly ImportedEvent[],
): number {
  if (events.length === 0) return 0;
  const db = getDb();
  const now = new Date().toISOString();
  let written = 0;

  db.withTransactionSync(() => {
    for (const e of events) {
      const eventId = newEventId();
      db.runSync(
        `INSERT INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
           tz, local_wall, precision, location_name, location_address, tickets_required,
           ticket_url, allow_suggestions, status, created_by, created_at, version, rrule,
           image_key, sync_state)
         VALUES (?,?,?,NULL,?,?,?,?,?,NULL,NULL,0,NULL,1,'active',?,?,1,NULL,NULL,'synced')`,
        [
          eventId,
          calendarId,
          e.title.trim() || "Busy",
          e.startUtc,
          e.endUtc,
          e.tz,
          e.localWall,
          e.allDay ? "date" : "datetime",
          CURRENT_USER_ID,
          now,
        ],
      );
      db.runSync(
        `INSERT OR REPLACE INTO device_links
           (event_id, device_event_id, device_calendar_id, direction, linked_at)
         VALUES (?,?,?,'in',?)`,
        [eventId, e.deviceEventId, e.deviceCalendarId, now],
      );
      written += 1;
    }
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('sync:last', ?)", [now]);
  });

  notifyChanged();
  return written;
}
