import { getDb, notifyChanged } from "./client";

/**
 * The sync entry point, standing in for §5 until the API exists.
 *
 * The shape is the one the real thing will have: push whatever is queued, then
 * pull changes since the last cursor. Wiring pull-to-refresh to this now means
 * the screens never learn a temporary shape they would have to unlearn — when
 * the endpoints land, only the body of this file changes.
 *
 * It deliberately does NOT pretend to succeed at talking to a server: there is
 * no server, so the queue is left alone rather than being silently cleared,
 * which would lose writes the moment one exists.
 */
export interface SyncResult {
  /** Changes applied from the server. Always zero until §5.2 ships. */
  applied: number;
  /** Local writes still waiting to be pushed. */
  pending: number;
  /** When this attempt finished. */
  at: string;
}

let inFlight: Promise<SyncResult> | null = null;

export function syncNow(): Promise<SyncResult> {
  // Two pulls at once would double the work and can interleave badly once
  // there is a cursor to advance, so callers share one attempt.
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<SyncResult> {
  const db = getDb();

  // A visible refresh that returns instantly reads as a failure, so the stub
  // takes about as long as a round trip will.
  await new Promise((resolve) => setTimeout(resolve, 650));

  const row = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM mutation_queue",
  );

  const result: SyncResult = {
    applied: 0,
    pending: row?.n ?? 0,
    at: new Date().toISOString(),
  };

  // Nothing changed locally yet, but re-reading is what a real pull ends with,
  // and doing it here proves the path from sync to screen.
  notifyChanged();
  return result;
}

export function lastSyncedLabel(at: string | null): string {
  if (!at) return "Not synced yet";
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins === 1) return "Updated a minute ago";
  if (mins < 60) return `Updated ${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "Updated an hour ago" : `Updated ${hours} hours ago`;
}
