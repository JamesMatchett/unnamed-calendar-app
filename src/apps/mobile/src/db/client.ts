import * as SQLite from "expo-sqlite";

import { SCHEMA, SCHEMA_VERSION } from "./schema";
import { seedIfEmpty } from "./seed";

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (db) return db;
  db = SQLite.openDatabaseSync("uca.db");
  db.execSync(SCHEMA);
  addMissingColumns(db);
  resetIfSchemaChanged(db);
  db.runSync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
    [String(SCHEMA_VERSION)],
  );
  seedIfEmpty(db);
  return db;
}

/**
 * `CREATE TABLE IF NOT EXISTS` adds new tables but never new columns, so a
 * column added to an existing table needs this. It is a real (if tiny) migration
 * and runs before the reset check — which means adding a field costs nobody
 * their data, unlike bumping the schema version.
 */
function addMissingColumns(database: SQLite.SQLiteDatabase): void {
  const added: [table: string, column: string, decl: string][] = [
    ["calendars", "allow_member_events", "INTEGER NOT NULL DEFAULT 1"],
    ["calendars", "travel_mode", "TEXT NOT NULL DEFAULT 'plane'"],
    ["availability", "travel_mode", "TEXT"],
  ];

  for (const [table, column, decl] of added) {
    const columns = database.getAllSync<{ name: string }>(
      `PRAGMA table_info(${table})`,
    );
    if (columns.some((c) => c.name === column)) continue;
    database.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl};`);
  }
}

/**
 * Prototype convenience, NOT a migration strategy.
 *
 * While the app runs on fixtures, a schema change means the seeded data is stale
 * — and a half-seeded database looks like a broken feature rather than an old
 * one. So the fixtures are dropped and rebuilt when the version moves.
 *
 * The moment real user data exists this must become proper migrations. It is
 * safe only because nothing here is authored by anyone.
 */
function resetIfSchemaChanged(database: SQLite.SQLiteDatabase): void {
  const stored = database.getFirstSync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'schema_version'",
  )?.value;

  if (stored === undefined || Number(stored) === SCHEMA_VERSION) return;

  for (const table of [
    "availability",
    "rsvps",
    "events",
    "members",
    "calendars",
    "notifications",
    "pending_invites",
    "friends",
    "directory",
    "mutation_queue",
  ]) {
    database.execSync(`DELETE FROM ${table};`);
  }
}

// --- a very small reactive layer ------------------------------------------
//
// Screens read synchronously from SQLite, so there is no async loading state to
// model. All that is needed is a nudge when something is written, so open
// screens re-query. This keeps optimistic writes (§5.6) instant without pulling
// in a state library the app does not otherwise need.

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyChanged(): void {
  for (const fn of listeners) fn();
}
