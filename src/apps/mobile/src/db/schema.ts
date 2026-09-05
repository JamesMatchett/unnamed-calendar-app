/**
 * The local SQLite mirror.
 *
 * This is not a cache in front of the API — it is THE read path. Every screen
 * reads from here, always, and sync is a background writer (Architecture.md
 * §5.6). That is why the app works identically with the server stubbed out.
 *
 * The shape deliberately mirrors the DynamoDB items in @calder/core rather than
 * being normalised for SQL convenience: a change arriving from the change log
 * must map to exactly one row without interpretation.
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS calendars (
  calendar_id          TEXT PRIMARY KEY NOT NULL,
  name                 TEXT NOT NULL,
  description          TEXT,
  mode                 TEXT NOT NULL CHECK (mode IN ('bounded','continuous')),
  start_date           TEXT,
  end_date             TEXT,
  default_tz           TEXT NOT NULL,
  collect_availability INTEGER NOT NULL DEFAULT 0,
  travel_mode          TEXT NOT NULL DEFAULT 'plane',
  cover_image          TEXT,
  -- Yours alone, or yours and one other person's. A flag rather than a member
  -- count: two people planning a weekend away are not the same thing as a
  -- couple's shared calendar, even though both have two members.
  is_private           INTEGER NOT NULL DEFAULT 0,
  require_approval     INTEGER NOT NULL DEFAULT 1,
  allow_member_invites INTEGER NOT NULL DEFAULT 1,
  allow_member_events  INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'active',
  created_by           TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  -- Sync watermark. Absence of a value means "never synced".
  last_seq             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS members (
  calendar_id  TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('owner','member')),
  -- Mirrors the soft delete in §8.4: rows persist so departed members still
  -- resolve to a name on events they created.
  status       TEXT NOT NULL CHECK (status IN ('active','left','removed')),
  display_name TEXT NOT NULL,
  joined_at    TEXT NOT NULL,
  PRIMARY KEY (calendar_id, user_id),
  FOREIGN KEY (calendar_id) REFERENCES calendars(calendar_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  event_id         TEXT PRIMARY KEY NOT NULL,
  calendar_id      TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  start_utc        TEXT NOT NULL,
  end_utc          TEXT,
  tz               TEXT NOT NULL,
  local_wall       TEXT NOT NULL,
  precision        TEXT NOT NULL CHECK (precision IN ('datetime','date','tbc')),
  location_name    TEXT,
  location_address TEXT,
  tickets_required INTEGER NOT NULL DEFAULT 0,
  ticket_url       TEXT,
  allow_suggestions INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  -- Who last changed it, and when. Shown on the event rather than kept for
  -- forensics: "Priya moved this to 9pm" is the difference between a calendar
  -- people trust and one that seems to rearrange itself (§8.1).
  updated_by       TEXT,
  updated_at       TEXT,
  -- 'fixed' | 'proposed' | 'open'. Anything but fixed means the time is still
  -- being decided and the event carries candidate slots (§8.1).
  scheduling_mode  TEXT NOT NULL DEFAULT 'fixed',
  rrule            TEXT,
  image_key        TEXT,
  -- 'synced' | 'pending' | 'failed'. Pending never blocks interaction (§5.6).
  sync_state       TEXT NOT NULL DEFAULT 'synced',
  FOREIGN KEY (calendar_id) REFERENCES calendars(calendar_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_calendar_start
  ON events (calendar_id, start_utc);

CREATE TABLE IF NOT EXISTS rsvps (
  event_id       TEXT NOT NULL,
  -- The occurrence instant, or '-' for the series default. One shape for every
  -- RSVP in the system, exactly as in the table (§5.5).
  occurrence     TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  calendar_id    TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('going','maybe','not_going')),
  responded_at   TEXT NOT NULL,
  -- 'have' | 'looking' | 'none'. NULL means they have not said, which is not the
  -- same as having decided they have not got one.
  ticket_status  TEXT,
  effective_from TEXT,
  sync_state     TEXT NOT NULL DEFAULT 'synced',
  PRIMARY KEY (event_id, occurrence, user_id),
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rsvps_user ON rsvps (user_id, calendar_id);

-- Mutations written while offline. Drained in order on reconnect; retried
-- indefinitely because client-generated ULIDs make every write idempotent
-- by primary key (§5.3).
CREATE TABLE IF NOT EXISTS mutation_queue (
  mutation_id TEXT PRIMARY KEY NOT NULL,
  calendar_id TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  body        TEXT NOT NULL,
  queued_at   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT
);

-- The inbox (§7.3). Written by the stream fan-out in production; seeded here.
-- One table, two surfaces: @calder/core decides which by kind, so People and
-- Activity can never disagree about where something belongs.
CREATE TABLE IF NOT EXISTS notifications (
  notification_id TEXT PRIMARY KEY NOT NULL,
  kind            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  read_at         TEXT,
  calendar_id     TEXT,
  calendar_name   TEXT,
  event_id        TEXT,
  event_title     TEXT,
  actor_id        TEXT,
  actor_name      TEXT,
  -- When this was handed to the operating system to show on the lock screen.
  -- NULL means it has not been, which is the whole queue: one column turns "is
  -- there anything new" into a query rather than something the app has to
  -- remember across launches. It is deliberately not the same as read_at, which
  -- is about the inbox inside the app.
  notified_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications (created_at DESC);

-- Calendar invites addressed to me and not yet answered (§7.1). Separate from
-- notifications because an invite is state, not news: it stays live until
-- answered, and answering it changes what I belong to.
CREATE TABLE IF NOT EXISTS pending_invites (
  calendar_id      TEXT PRIMARY KEY NOT NULL,
  calendar_name    TEXT NOT NULL,
  calendar_mode    TEXT NOT NULL,
  start_date       TEXT,
  end_date         TEXT,
  event_count      INTEGER NOT NULL DEFAULT 0,
  member_count     INTEGER NOT NULL DEFAULT 0,
  invited_by_name  TEXT NOT NULL,
  invited_at       TEXT NOT NULL,
  -- 'pending' | 'accepted' | 'declined'. Answers are kept rather than deleted so
  -- the optimistic write has somewhere to land before sync exists.
  state            TEXT NOT NULL DEFAULT 'pending'
);

-- A direct invitation to one thing, from one person to another (§8.1).
--
-- Not a calendar membership and not an RSVP: the event lives in the sender's
-- own calendar, which the invitee cannot see, so the invite CARRIES what they
-- need to answer it. Saying yes copies it into their own calendar; the two
-- copies are linked through accepted_event_id and otherwise lead separate lives.
CREATE TABLE IF NOT EXISTS event_invites (
  invite_id         TEXT PRIMARY KEY NOT NULL,
  -- The sender's event. Absent on the invitee's side until sync exists.
  event_id          TEXT NOT NULL,
  from_user         TEXT NOT NULL,
  from_name         TEXT NOT NULL,
  to_user           TEXT NOT NULL,
  title             TEXT NOT NULL,
  start_utc         TEXT NOT NULL,
  end_utc           TEXT,
  tz                TEXT NOT NULL,
  local_wall        TEXT NOT NULL,
  precision         TEXT NOT NULL DEFAULT 'datetime',
  location_name     TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','declined')),
  sent_at           TEXT NOT NULL,
  answered_at       TEXT,
  -- The invitee's copy, once they have said yes.
  accepted_event_id TEXT
);

-- Stands in for the discovery API of §7.3. In production a search hits the
-- server; here it is a local table so the interaction can be judged before any
-- backend exists. Handles are stored lowercased — they are identifiers, not
-- display text.
CREATE TABLE IF NOT EXISTS directory (
  user_id      TEXT PRIMARY KEY NOT NULL,
  handle       TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email        TEXT
);

CREATE INDEX IF NOT EXISTS idx_directory_handle ON directory (handle);

-- One row per direction, holding what the OWNER grants (§7.3). Here only the
-- current user's rows exist, so grants is what I let them see.
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT PRIMARY KEY NOT NULL,
  -- 'pending_out' — I asked them. 'pending_in' — they asked me.
  status  TEXT NOT NULL CHECK (status IN ('pending_out','pending_in','accepted')),
  -- §7.4. Inert until free/busy exists; recorded now so the shape is right.
  grants  TEXT NOT NULL DEFAULT 'none' CHECK (grants IN ('none','busy','full')),
  -- The mirror: what THEY have chosen to let me see. Stored separately because
  -- visibility is not reciprocal, and showing my own setting back to me as if
  -- it were theirs would be a lie in the one place that must not lie.
  shares  TEXT NOT NULL DEFAULT 'none' CHECK (shares IN ('none','busy','full')),
  since   TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES directory(user_id) ON DELETE CASCADE
);

-- Arrival and departure, when the calendar collects it (§4.3).
-- Deliberately NOT events: nobody RSVPs to a flight landing, and modelling it as
-- one buries the actual fact (who is here) inside something shaped like a
-- dinner reservation.
CREATE TABLE IF NOT EXISTS availability (
  calendar_id TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  arrives_at  TEXT,
  departs_at  TEXT,
  -- NULL means "whatever the calendar says", so changing the group's mode still
  -- moves everyone who never chose their own.
  travel_mode TEXT,
  -- How they are getting home, when that differs. NULL means "the same way I
  -- came", which is what it is for almost everyone: recording a second answer
  -- only when there is one keeps a single tap meaning both directions.
  travel_mode_out TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (calendar_id, user_id),
  FOREIGN KEY (calendar_id) REFERENCES calendars(calendar_id) ON DELETE CASCADE
);

-- Invites this user has SENT, as opposed to pending_invites which are addressed
-- to them (§7.1). Added without a schema-version bump: CREATE IF NOT EXISTS runs
-- on every launch, and a new empty table needs no reseed — so existing fixtures
-- survive.
CREATE TABLE IF NOT EXISTS sent_invites (
  calendar_id TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  invited_at  TEXT NOT NULL,
  PRIMARY KEY (calendar_id, user_id),
  FOREIGN KEY (calendar_id) REFERENCES calendars(calendar_id) ON DELETE CASCADE
);

-- One live link per calendar (§7.1): rotating the token revokes every copy at
-- once, which is why there is no need to track them individually.
CREATE TABLE IF NOT EXISTS invite_links (
  calendar_id TEXT PRIMARY KEY NOT NULL,
  token       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  uses        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (calendar_id) REFERENCES calendars(calendar_id) ON DELETE CASCADE
);

-- People waiting for an owner to let them in (§7.1). Kept separate from members
-- so that "asked to join" and "is in the calendar" can never be confused.
CREATE TABLE IF NOT EXISTS join_requests (
  calendar_id        TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  requested_at       TEXT NOT NULL,
  via_token          TEXT,
  previously_removed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (calendar_id, user_id)
);

-- Proposed changes to an event, from someone who is not its owner (§8.1).
-- Stored as the fields being changed rather than a whole event, so a diff is
-- what the data IS rather than something reconstructed for display, and two
-- suggestions touching different fields do not clobber one another.
CREATE TABLE IF NOT EXISTS suggestions (
  suggestion_id TEXT PRIMARY KEY NOT NULL,
  event_id      TEXT NOT NULL,
  calendar_id   TEXT NOT NULL,
  suggested_by  TEXT NOT NULL,
  suggested_by_name TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  note          TEXT,
  -- JSON object of field -> proposed value. Only the fields being changed.
  changes       TEXT NOT NULL,
  -- The event version the suggestion was written against, so an owner editing
  -- underneath it can be spotted rather than silently overwritten.
  base_version  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected')),
  resolved_at   TEXT,
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_suggestions_event
  ON suggestions (event_id, status);

-- Candidate times for an event whose date is not settled.
--
-- Separate rows rather than a JSON blob on the event: people answer per slot,
-- and votes have to key off something stable. A blob would also make two people
-- adding a slot at once a lost-update, which is exactly the moment a poll is
-- busiest.
CREATE TABLE IF NOT EXISTS event_slots (
  slot_id          TEXT PRIMARY KEY NOT NULL,
  event_id         TEXT NOT NULL,
  calendar_id      TEXT NOT NULL,
  start_utc        TEXT NOT NULL,
  end_utc          TEXT,
  tz               TEXT NOT NULL,
  local_wall       TEXT NOT NULL,
  precision        TEXT NOT NULL DEFAULT 'datetime'
                     CHECK (precision IN ('datetime','date')),
  proposed_by      TEXT NOT NULL,
  proposed_by_name TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  sync_state       TEXT NOT NULL DEFAULT 'synced',
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_slots_event ON event_slots (event_id, start_utc);

-- One answer per person per slot. The key includes the user, so two people
-- answering at once can never collide (§4.4 pattern 5).
CREATE TABLE IF NOT EXISTS slot_votes (
  slot_id      TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  response     TEXT NOT NULL CHECK (response IN ('yes','if_need_be','no')),
  responded_at TEXT NOT NULL,
  sync_state   TEXT NOT NULL DEFAULT 'synced',
  PRIMARY KEY (slot_id, user_id),
  FOREIGN KEY (slot_id) REFERENCES event_slots(slot_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_slot_votes_event ON slot_votes (event_id);

-- What this app has already copied to or from the phone's own calendar (§5.7).
--
-- The whole point of storing this is that a sync run twice must not write
-- everything twice. Without a link, the second run has no way to tell "this
-- dinner is already over there" from "this dinner is new", and the honest
-- answer to that ambiguity is forty duplicates.
--
-- Direction is part of the key rather than a column beside it because the two
-- directions mean opposite things: an 'out' row says WE made the copy on the
-- phone and are responsible for deleting it, an 'in' row says the phone's event
-- is the original and ours is the copy. Confusing the two deletes somebody's
-- real meeting.
CREATE TABLE IF NOT EXISTS device_links (
  event_id           TEXT NOT NULL,
  device_event_id    TEXT NOT NULL,
  device_calendar_id TEXT NOT NULL,
  direction          TEXT NOT NULL CHECK (direction IN ('out','in')),
  -- What the event looked like when the copy was written (§5.7's
  -- lastSyncedHash). Its absence is what makes a second run rewrite everything
  -- it wrote the first time, which on iOS is visible as the whole week
  -- flickering in the calendar app. NULL means unknown, not unchanged.
  hash               TEXT,
  linked_at          TEXT NOT NULL,
  PRIMARY KEY (event_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_device_links_device
  ON device_links (direction, device_event_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;
