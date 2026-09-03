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
  actor_name      TEXT
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

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;
