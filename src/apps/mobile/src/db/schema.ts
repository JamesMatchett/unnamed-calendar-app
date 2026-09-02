/**
 * The local SQLite mirror.
 *
 * This is not a cache in front of the API — it is THE read path. Every screen
 * reads from here, always, and sync is a background writer (Architecture.md
 * §5.6). That is why the app works identically with the server stubbed out.
 *
 * The shape deliberately mirrors the DynamoDB items in @uca/core rather than
 * being normalised for SQL convenience: a change arriving from the change log
 * must map to exactly one row without interpretation.
 */

export const SCHEMA_VERSION = 1;

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
  require_approval     INTEGER NOT NULL DEFAULT 1,
  allow_member_invites INTEGER NOT NULL DEFAULT 1,
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
  has_ticket     INTEGER,
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

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;
