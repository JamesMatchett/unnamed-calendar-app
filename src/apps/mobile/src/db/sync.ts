import type {
  CalendarItem,
  ChangesResponse,
  EventItem,
  MembershipItem,
  RsvpItem,
  SnapshotRequired,
} from "@calder/core";

import { call, type ApiFailure, type Method } from "@/lib/api";
import { getIdToken } from "@/lib/auth";
import { loadSession } from "@/lib/session";

import { applyCalendar, applyChanges, applyItem, applyMembership } from "./apply";
import { getDb, notifyChanged } from "./client";

/**
 * Sync (§5.2, §5.3): push whatever is queued, then pull what has changed.
 *
 * Two halves, in that order, because the pull is how this phone learns the
 * outcome of its own writes: a queued create goes up, the server logs it, and
 * the next page of the feed brings it back marked settled. Pulling first would
 * fetch a feed that does not yet contain what is about to be sent.
 *
 * Everything here reads and writes SQLite synchronously between network calls,
 * and the screens read SQLite, so there is no state to reconcile: when a page
 * lands, the next render shows it (§5.6).
 */
export interface SyncResult {
  /** Changes applied from the server. */
  applied: number;
  /** Local writes acknowledged by the server this time. */
  pushed: number;
  /** Local writes still waiting. */
  pending: number;
  /** When this attempt finished. */
  at: string;
  /** False when there is no session, or the one there is cannot be renewed. */
  signedIn: boolean;
  /** What stopped the attempt, if anything did. Null when it ran to the end. */
  failed: string | null;
}

export interface SyncStatus {
  /** Null before the first attempt, so a fresh install does not nag. */
  readonly signedIn: boolean | null;
  readonly lastAt: string | null;
  readonly lastError: string | null;
}

/** How many pages of the feed one attempt will take for one calendar. */
const MAX_PAGES = 20;
const PAGE = 500;

let inFlight: Promise<SyncResult> | null = null;
let syncing = false;
let status: SyncStatus = { signedIn: null, lastAt: null, lastError: null };
const listeners = new Set<() => void>();

export const isSyncing = (): boolean => syncing;
export const getSyncStatus = (): SyncStatus => status;

export function subscribeSyncState(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

function setSyncing(next: boolean): void {
  if (syncing === next) return;
  syncing = next;
  emit();
}

function setStatus(next: SyncStatus): void {
  status = next;
  emit();
}

export function syncNow(): Promise<SyncResult> {
  // Two attempts at once would double the work and interleave their watermark
  // updates, so callers share one. The second caller gets the first's result,
  // which is what it would have found anyway.
  inFlight ??= run().finally(() => {
    inFlight = null;
    setSyncing(false);
  });
  setSyncing(true);
  return inFlight;
}

const describe = (error: ApiFailure): string =>
  error.kind === "status" ? `${error.status}: ${error.detail}` : `${error.kind}: ${error.detail}`;

async function run(): Promise<SyncResult> {
  const db = getDb();
  const pendingNow = (): number =>
    db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM mutation_queue")?.n ?? 0;

  const session = await loadSession();
  const token = session === null ? null : await getIdToken();

  if (token === null) {
    // No session, or one that has aged out and could not be renewed (offline,
    // or the refresh token itself has lapsed). Local data stays readable and
    // the queue stays queued (§5.6); nothing is sent and nothing is dropped.
    const result: SyncResult = {
      applied: 0,
      pushed: 0,
      pending: pendingNow(),
      at: new Date().toISOString(),
      signedIn: false,
      failed: session === null ? "not signed in" : "session expired",
    };
    setStatus({ signedIn: false, lastAt: status.lastAt, lastError: result.failed });
    return result;
  }

  const pushed = await push(db, token);
  const pulled = pushed.stopped === "unauthenticated" ? { applied: 0, failed: null } : await pull(db, token);

  const failed = pushed.failed ?? pulled.failed;
  const at = new Date().toISOString();
  db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync_at', ?)", [at]);

  // Re-read is what a pull ends with, whether or not anything changed: the
  // pending count moved even when no page did.
  notifyChanged();
  setStatus({
    signedIn: pushed.stopped !== "unauthenticated",
    lastAt: at,
    lastError: failed,
  });

  return {
    applied: pulled.applied,
    pushed: pushed.count,
    pending: pendingNow(),
    at,
    signedIn: pushed.stopped !== "unauthenticated",
    failed,
  };
}

// --- push ------------------------------------------------------------------

interface QueuedRow {
  mutation_id: string;
  calendar_id: string;
  method: Method;
  path: string;
  body: string;
  attempts: number;
}

/** What the server hands back for a write: the item as it now stands. */
interface Acknowledged {
  calendar?: CalendarItem;
  membership?: MembershipItem;
  event?: EventItem;
  rsvp?: RsvpItem;
}

/**
 * Drain the queue, in order, stopping at the first thing that might work later.
 *
 * Three outcomes per write, and they are treated very differently:
 *
 *   2xx    done. The row goes, and the item the server returned is applied,
 *          so the thing that was pending is drawn settled without waiting
 *          for the feed to say so.
 *   4xx    will never work. 400 is a body the server will not take, 403 a
 *          permission this phone thought it had, 404 a calendar it is no
 *          longer in, 409 an edit somebody else beat (§5.4). Retrying any of
 *          them is the same answer forever, so the row goes, and the pull
 *          that follows brings back what the server actually holds.
 *   else   might work later: offline, a timeout, a 5xx. The row stays, with
 *          the attempt counted and the reason kept, and the drain stops here
 *          rather than skipping ahead, because the writes behind it may
 *          depend on it (an RSVP to an event whose create has not landed).
 *
 * 401 is the one 4xx that is not final: the token is stale, not the write.
 * The drain stops and nothing is dropped.
 */
async function push(
  db: ReturnType<typeof getDb>,
  token: string,
): Promise<{ count: number; failed: string | null; stopped: "unauthenticated" | "unreachable" | null }> {
  const rows = db.getAllSync<QueuedRow>(
    "SELECT mutation_id, calendar_id, method, path, body, attempts FROM mutation_queue ORDER BY queued_at",
  );

  let count = 0;
  for (const row of rows) {
    let body: unknown;
    try {
      body = JSON.parse(row.body) as unknown;
    } catch {
      body = {};
    }

    const result = await call<Acknowledged>({ method: row.method, path: row.path, body, token });

    if (result.ok) {
      db.withTransactionSync(() => {
        db.runSync("DELETE FROM mutation_queue WHERE mutation_id = ?", [row.mutation_id]);
        acknowledge(db, result.value);
      });
      count += 1;
      continue;
    }

    const { error } = result;
    if (error.kind === "status" && error.status === 401) {
      return { count, failed: "session rejected; sign in again", stopped: "unauthenticated" };
    }

    if (error.kind === "status" && error.status >= 400 && error.status < 500) {
      if (__DEV__) console.warn(`[sync] dropped ${row.method} ${row.path}: ${describe(error)}`);
      db.withTransactionSync(() => {
        db.runSync("DELETE FROM mutation_queue WHERE mutation_id = ?", [row.mutation_id]);
        // The row this write was for is no longer pending anything; it is
        // whatever the server says, which the pull is about to deliver. Until
        // then it must not be drawn as waiting, and its local version must
        // not outrank the server's or the pull would refuse to overwrite it.
        settle(db, row);
      });
      continue;
    }

    db.runSync(
      "UPDATE mutation_queue SET attempts = attempts + 1, last_error = ? WHERE mutation_id = ?",
      [describe(error), row.mutation_id],
    );
    return { count, failed: describe(error), stopped: "unreachable" };
  }

  return { count, failed: null, stopped: null };
}

function acknowledge(db: ReturnType<typeof getDb>, ack: Acknowledged): void {
  for (const item of [ack.calendar, ack.membership, ack.event, ack.rsvp]) {
    // Forced: this is the outcome of our own write, not a stale put.
    if (item !== undefined) applyItem(db, item, true);
  }
}

/** The local row a dropped write was about stops claiming to be pending. */
function settle(db: ReturnType<typeof getDb>, row: QueuedRow): void {
  const event = row.path.match(/\/events\/([^/]+)$/)?.[1];
  const rsvp = row.path.match(/\/events\/([^/]+)\/rsvp/)?.[1];
  if (event !== undefined) {
    db.runSync(
      "UPDATE events SET sync_state = 'synced', version = MAX(base_version, 1) WHERE event_id = ?",
      [event],
    );
  } else if (rsvp !== undefined) {
    db.runSync("UPDATE rsvps SET sync_state = 'synced' WHERE event_id = ?", [rsvp]);
  }
}

// --- pull ------------------------------------------------------------------

interface Snapshot {
  calendar: CalendarItem;
  membership: MembershipItem;
}

/**
 * Every calendar this person is in, each brought up to its watermark.
 *
 * The list comes from the sparse index and holds ids alone; the content of
 * each comes through its feed. A calendar the phone has never seen is fetched
 * whole first, so its row exists before the feed's events try to attach to it.
 *
 * A 404 on the feed means the calendar has gone, or this person has: either
 * way it is drawn deleted here, and the row stays so the Calendars tab can say
 * so rather than having it vanish. A 410 means this phone's watermark predates
 * the log (§5.2); there is no snapshot yet to start again from, so the
 * watermark is moved to where the log now begins and what remains is applied.
 */
async function pull(
  db: ReturnType<typeof getDb>,
  token: string,
): Promise<{ applied: number; failed: string | null }> {
  const list = await call<{ calendarIds: string[] }>({ method: "GET", path: "/v1/calendars", token });
  if (!list.ok) return { applied: 0, failed: describe(list.error) };

  let applied = 0;
  let failed: string | null = null;

  for (const calendarId of list.value.calendarIds) {
    const local = db.getFirstSync<{ last_seq: number }>(
      "SELECT last_seq FROM calendars WHERE calendar_id = ?",
      [calendarId],
    );

    if (local === null) {
      const whole = await call<Snapshot>({ method: "GET", path: `/v1/calendars/${calendarId}`, token });
      if (!whole.ok) {
        failed ??= describe(whole.error);
        continue;
      }
      db.withTransactionSync(() => {
        applyCalendar(db, whole.value.calendar);
        applyMembership(db, whole.value.membership);
      });
      applied += 2;
    }

    let since = local?.last_seq ?? 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const feed = await call<ChangesResponse>({
        method: "GET",
        path: `/v1/calendars/${calendarId}/changes?since=${since}&limit=${PAGE}`,
        token,
      });

      if (!feed.ok) {
        const { error } = feed;
        if (error.kind === "status" && error.status === 404) {
          db.runSync("UPDATE calendars SET status = 'deleted' WHERE calendar_id = ?", [calendarId]);
          break;
        }
        if (error.kind === "status" && error.status === 410) {
          const gone = error.body as Partial<SnapshotRequired> | undefined;
          const floor = typeof gone?.asOfSeq === "number" ? gone.asOfSeq - 1 : null;
          if (floor !== null && floor > since) {
            since = floor;
            continue;
          }
        }
        failed ??= describe(error);
        break;
      }

      applied += applyChanges(db, calendarId, feed.value.changes);
      since = feed.value.nextSeq;
      db.runSync("UPDATE calendars SET last_seq = ? WHERE calendar_id = ?", [since, calendarId]);
      if (!feed.value.hasMore) break;
    }
  }

  return { applied, failed };
}

// --- labels ----------------------------------------------------------------

export function lastSyncedLabel(at: string | null): string {
  if (!at) return "Not synced yet";
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins === 1) return "Updated a minute ago";
  if (mins < 60) return `Updated ${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "Updated an hour ago" : `Updated ${hours} hours ago`;
}
