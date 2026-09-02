/**
 * The delta-sync contract between client and API. Architecture.md §5.2, §5.3.
 *
 * The client never queries by date range for its own calendars: it holds them
 * whole in SQLite and reconciles by sequence number.
 */

import type { AnyItem, ChangeOp, EntityType } from "./entities.js";
import type { CalendarId, UserId } from "./ids.js";
import type { Instant } from "./time.js";

export interface ChangesRequest {
  readonly calendarId: CalendarId;
  /** Exclusive lower bound. Omit or pass 0 for a first sync. */
  readonly since: number;
  readonly limit?: number;
}

export interface Change {
  readonly seq: number;
  readonly op: ChangeOp;
  readonly targetType: EntityType;
  readonly targetId: string;
  readonly actorId: UserId;
  readonly serverTs: Instant;
  /** Absent for deletes: the tombstone carries no body. */
  readonly item?: AnyItem;
}

export interface ChangesResponse {
  readonly changes: readonly Change[];
  readonly nextSeq: number;
  readonly hasMore: boolean;
}

/**
 * Returned as HTTP 410 when the client's watermark predates the retained change
 * log. It is not an error state: the client downloads the snapshot and starts
 * again from it, which is what bounds log growth and removes a whole class of
 * edge cases (§5.2).
 */
export interface SnapshotRequired {
  readonly snapshotUrl: string;
  readonly asOfSeq: number;
}

export type SyncOutcome = ChangesResponse | SnapshotRequired;

export const isSnapshotRequired = (o: SyncOutcome): o is SnapshotRequired =>
  "snapshotUrl" in o;

/**
 * How a locally-written item is displayed before the server acknowledges it.
 * `pending` must never block interaction — a pending event can still be edited,
 * RSVP'd to and cancelled (§5.6).
 */
export type LocalSyncState = "synced" | "pending" | "failed";

/**
 * A queued mutation. The client generates the ULID, so the write is idempotent
 * by primary key and can be retried indefinitely — which is what lets the queue
 * survive a two-week trip without special handling (§5.3).
 */
export interface QueuedMutation {
  readonly mutationId: string;
  readonly calendarId: CalendarId;
  readonly method: "PUT" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body: unknown;
  readonly queuedAt: Instant;
  readonly attempts: number;
  readonly lastError?: string;
}
