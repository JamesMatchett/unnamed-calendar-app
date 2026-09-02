/**
 * Queries. Deliberately shaped to mirror the access patterns in §4.4 rather than
 * whatever SQL happens to be convenient — so that when the sync layer arrives,
 * every screen is already asking for something the server can cheaply serve.
 */

import type {
  DayPresence,
  NotificationKind,
  NotificationSurface,
  RsvpAnswer,
  RsvpStatus,
  TravelMode,
} from "@uca/core";
import { ulid } from "ulid";
import {
  SERIES_DEFAULT,
  classifyPresence,
  isActionable,
  newCalendarId,
  newEventId,
  resolveRsvp,
  surfaceFor,
  tallyRsvps,
} from "@uca/core";

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
  travel_mode: TravelMode;
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
  // The split lives in @uca/core so the two surfaces cannot disagree.
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

  return { people: invites + friendRequests, activity };
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
 * One search box over handle, name and email (§7.3). A leading "@" is stripped
 * so that typing the handle as people write it still matches.
 */
export function searchPeople(query: string): PersonRow[] {
  const q = query.trim().replace(/^@/, "").toLowerCase();
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
      `INSERT INTO calendars (calendar_id, name, description, mode, start_date, end_date,
         default_tz, collect_availability, travel_mode, require_approval,
         allow_member_invites, allow_member_events, status, created_by, created_at, last_seq)
       VALUES (?,?,NULL,?,?,?,?,?,?,1,1,?,'active',?,?,0)`,
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
        CURRENT_USER_ID,
        now,
      ],
    );

    db.runSync(
      `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
       VALUES (?,?, 'owner', 'active', ?, ?)`,
      [calendarId, CURRENT_USER_ID, "James", now],
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
}

export function listAvailability(calendarId: string): AvailabilityRow[] {
  return getDb().getAllSync<AvailabilityRow>(
    "SELECT user_id, arrives_at, departs_at, travel_mode FROM availability WHERE calendar_id = ?",
    [calendarId],
  );
}

/**
 * Presence for one day, classified in @uca/core so the client and the future API
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
    `SELECT user_id, arrives_at, departs_at, travel_mode FROM availability
      WHERE calendar_id = ? AND user_id = ?`,
    [calendarId, CURRENT_USER_ID],
  );
}

export function setMyAvailability(
  calendarId: string,
  arrivesAt: string | null,
  departsAt: string | null,
  travelMode: TravelMode | null = null,
): void {
  getDb().runSync(
    `INSERT INTO availability (calendar_id, user_id, arrives_at, departs_at, travel_mode, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (calendar_id, user_id)
     DO UPDATE SET arrives_at = excluded.arrives_at,
                   departs_at = excluded.departs_at,
                   travel_mode = excluded.travel_mode,
                   updated_at = excluded.updated_at`,
    [
      calendarId,
      CURRENT_USER_ID,
      arrivesAt,
      departsAt,
      travelMode,
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
  }>,
): void {
  const sets: string[] = [];
  const args: (string | number)[] = [];

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
  getDb().runSync(
    "UPDATE members SET status = ? WHERE calendar_id = ? AND user_id = ?",
    [status, calendarId, userId],
  );
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
}

export function createEvent(calendarId: string, input: NewEvent): string {
  const db = getDb();
  const eventId = newEventId();
  const now = new Date().toISOString();

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
         tz, local_wall, precision, location_name, location_address, tickets_required,
         ticket_url, allow_suggestions, status, created_by, created_at, version, rrule, sync_state)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active',?,?,1,NULL,'pending')`,
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
