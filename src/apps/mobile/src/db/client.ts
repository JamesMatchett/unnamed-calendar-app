import * as SQLite from "expo-sqlite";

import { SCHEMA, SCHEMA_VERSION } from "./schema";
import { seedIfEmpty } from "./seed";

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (db) return db;
  db = SQLite.openDatabaseSync("uca.db");
  db.execSync(SCHEMA);
  db.runSync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
    [String(SCHEMA_VERSION)],
  );
  seedIfEmpty(db);
  return db;
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
