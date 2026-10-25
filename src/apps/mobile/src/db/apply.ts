import type {
  AnyItem,
  CalendarItem,
  Change,
  EventItem,
  MembershipItem,
  RsvpItem,
} from "@calder/core";
import type * as SQLite from "expo-sqlite";

/**
 * Writing what the server says into the mirror.
 *
 * One function per item type, each an upsert keyed the way the table is keyed,
 * because the change feed delivers puts and deletes and nothing else (§5.1): a
 * client that missed an insert must still be able to apply the update that
 * follows it, so every put is "make the row look like this" rather than
 * "change these fields".
 *
 * The item shapes come from @calder/core, the same file the API reads them
 * from. The columns here are the only place the two vocabularies meet.
 */

const flag = (b: boolean | undefined): number => (b ? 1 : 0);

export function applyCalendar(db: SQLite.SQLiteDatabase, item: CalendarItem): void {
  db.runSync(
    `INSERT INTO calendars (calendar_id, name, description, mode, start_date, end_date,
       default_tz, collect_availability, travel_mode, cover_image, require_approval,
       allow_member_invites, allow_member_events, status, created_by, created_at, version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (calendar_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       mode = excluded.mode,
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       default_tz = excluded.default_tz,
       collect_availability = excluded.collect_availability,
       travel_mode = excluded.travel_mode,
       -- A cover chosen on this phone is a local file until uploads exist
       -- (§3.4); the server has nothing better to say about it yet.
       cover_image = COALESCE(excluded.cover_image, calendars.cover_image),
       require_approval = excluded.require_approval,
       allow_member_invites = excluded.allow_member_invites,
       allow_member_events = excluded.allow_member_events,
       status = excluded.status,
       created_by = excluded.created_by,
       created_at = excluded.created_at,
       version = excluded.version`,
    [
      item.calendarId,
      item.name,
      item.description ?? null,
      item.mode,
      item.startDate ?? null,
      item.endDate ?? null,
      item.defaultTz,
      flag(item.collectAvailability),
      item.travelMode ?? "plane",
      item.coverImageUrl ?? null,
      flag(item.requireApproval),
      flag(item.allowMemberInvites),
      flag(item.allowMemberEvents),
      item.status,
      item.createdBy,
      item.createdAt,
      item.version ?? 1,
    ],
  );
}

export function applyMembership(db: SQLite.SQLiteDatabase, item: MembershipItem): void {
  db.runSync(
    `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (calendar_id, user_id) DO UPDATE SET
       role = excluded.role,
       status = excluded.status,
       -- An empty name is the server saying the provider never sent one. The
       -- name chosen on this phone is better than that, so it stays.
       display_name = COALESCE(NULLIF(excluded.display_name, ''), members.display_name),
       joined_at = excluded.joined_at`,
    [item.calendarId, item.userId, item.role, item.status, item.displayName ?? "", item.joinedAt],
  );
}

/**
 * `force` is for the server's answer to THIS phone's own write. The guard at
 * the bottom protects a pending local edit from an older put arriving through
 * the feed; an acknowledgement is not older, it is the outcome, and two local
 * edits collapsed into one send would otherwise leave the row pending for
 * ever with a version the server never issued.
 */
export function applyEvent(db: SQLite.SQLiteDatabase, item: EventItem, force = false): void {
  db.runSync(
    `INSERT INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
       tz, local_wall, precision, location_name, location_address, tickets_required,
       ticket_url, allow_suggestions, status, created_by, created_at, version,
       updated_by, updated_at, rrule, sync_state, base_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced',?)
     ON CONFLICT (event_id) DO UPDATE SET
       calendar_id = excluded.calendar_id,
       title = excluded.title,
       description = excluded.description,
       start_utc = excluded.start_utc,
       end_utc = excluded.end_utc,
       tz = excluded.tz,
       local_wall = excluded.local_wall,
       precision = excluded.precision,
       location_name = excluded.location_name,
       location_address = excluded.location_address,
       tickets_required = excluded.tickets_required,
       ticket_url = excluded.ticket_url,
       allow_suggestions = excluded.allow_suggestions,
       status = excluded.status,
       created_by = excluded.created_by,
       created_at = excluded.created_at,
       version = excluded.version,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at,
       rrule = excluded.rrule,
       sync_state = 'synced',
       base_version = excluded.base_version
     -- A put the feed delivers can be OLDER than an edit still waiting in the
     -- queue: the server has not seen the edit yet, so its view is behind this
     -- phone's. Overwriting would make the edit vanish until the queue drains
     -- and the next pull brings it back. Settled rows take the server's word;
     -- pending ones take it only when it has caught up.
     WHERE ? = 1 OR events.sync_state = 'synced' OR excluded.version >= events.version`,
    [
      item.eventId,
      item.calendarId,
      item.title,
      item.description ?? null,
      item.time.startUtc,
      item.time.endUtc ?? null,
      item.time.tz,
      item.time.localWall,
      item.time.precision,
      item.location?.name ?? null,
      item.location?.address ?? null,
      flag(item.ticketsRequired),
      item.ticketUrl ?? null,
      flag(item.allowSuggestions !== false),
      item.status,
      item.createdBy,
      item.createdAt,
      item.version,
      // Attribution only once somebody has changed it: the author's own first
      // write is not "edited by the author" (§8.1).
      item.version > 1 ? item.lastUpdatedBy : null,
      item.version > 1 ? item.lastUpdatedAt : null,
      item.rrule ?? null,
      item.version,
      force ? 1 : 0,
    ],
  );
}

export function applyRsvp(db: SQLite.SQLiteDatabase, item: RsvpItem): void {
  db.runSync(
    `INSERT INTO rsvps (event_id, occurrence, user_id, calendar_id, status, responded_at,
       ticket_status, effective_from, sync_state)
     VALUES (?,?,?,?,?,?,?,?,'synced')
     ON CONFLICT (event_id, occurrence, user_id) DO UPDATE SET
       calendar_id = excluded.calendar_id,
       status = excluded.status,
       responded_at = excluded.responded_at,
       ticket_status = excluded.ticket_status,
       effective_from = excluded.effective_from,
       sync_state = 'synced'`,
    [
      item.eventId,
      item.occurrence,
      item.userId,
      item.calendarId,
      item.status,
      item.respondedAt,
      item.ticketStatus ?? null,
      item.effectiveFrom ?? null,
    ],
  );
}

/**
 * One item of any kind. The ones with no row here yet (suggestions,
 * availability, invites) are skipped rather than failed: the feed carries
 * everything in the partition, and a client should not break because the
 * server learned a new word before it did.
 */
export function applyItem(db: SQLite.SQLiteDatabase, item: AnyItem, force = false): boolean {
  switch (item.entityType) {
    case "calendar":
      applyCalendar(db, item);
      return true;
    case "membership":
      applyMembership(db, item);
      return true;
    case "event":
      applyEvent(db, item, force);
      return true;
    case "rsvp":
      applyRsvp(db, item);
      return true;
    default:
      return false;
  }
}

/**
 * A delete, from the sort key alone. The tombstone carries no body (§5.1), so
 * the key is the whole message, and keys.ts is where its shape is decided.
 */
export function applyDelete(db: SQLite.SQLiteDatabase, calendarId: string, targetId: string): boolean {
  const [kind, ...rest] = targetId.split("#");
  switch (kind) {
    case "EVENT":
      db.runSync("DELETE FROM events WHERE event_id = ?", [rest[0] ?? ""]);
      return true;
    case "RSVP": {
      // RSVP#{eventId}#{occurrence}#{userId}. An occurrence is an instant or
      // "-", neither of which contains "#", so the split is safe.
      const [eventId, occurrence, userId] = rest;
      db.runSync(
        "DELETE FROM rsvps WHERE event_id = ? AND occurrence = ? AND user_id = ?",
        [eventId ?? "", occurrence ?? "", userId ?? ""],
      );
      return true;
    }
    case "MEMBER":
      db.runSync("DELETE FROM members WHERE calendar_id = ? AND user_id = ?", [calendarId, rest[0] ?? ""]);
      return true;
    case "META":
      // The thirty days are up (§8.5). Locally the calendar was already
      // deleted by the status change that preceded this; make sure.
      db.runSync("UPDATE calendars SET status = 'deleted' WHERE calendar_id = ?", [calendarId]);
      return true;
    default:
      return false;
  }
}

/**
 * One page of the feed, in order, in one transaction.
 *
 * Returns how many changes were applied. A row that cannot be written, an
 * answer to an event this phone does not have, say, is skipped rather than
 * allowed to stop the page: the feed is replayable, but a page that fails
 * halfway and is retried whole re-applies what already landed, and a page
 * that is never completed stops this calendar syncing for good.
 */
export function applyChanges(
  db: SQLite.SQLiteDatabase,
  calendarId: string,
  changes: readonly Change[],
): number {
  let applied = 0;
  db.withTransactionSync(() => {
    for (const change of changes) {
      try {
        if (change.op === "delete") {
          if (applyDelete(db, calendarId, change.targetId)) applied += 1;
        } else if (change.item !== undefined && applyItem(db, change.item)) {
          applied += 1;
        }
      } catch (cause) {
        if (__DEV__) console.warn(`[sync] could not apply ${change.op} ${change.targetId}`, cause);
      }
    }
  });
  return applied;
}
