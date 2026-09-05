/**
 * GET /v1/calendars/{cid}/changes?since={seq} — the sync endpoint (§5.2).
 *
 * A Query with a BETWEEN on the change prefix, which is one request whatever
 * the client has missed, because the change items sort under the calendar's own
 * partition in sequence order. The client holds its calendars whole in SQLite
 * and reconciles by sequence number; it never asks for a date range.
 *
 * The wire types come from @calder/core rather than being restated here. There
 * is one contract and both ends read it from the same file, which is the only
 * way a change to it can fail loudly instead of at runtime on somebody's phone.
 */

import type {
  AnyItem,
  CalendarId,
  Change,
  ChangeLogItem,
  ChangesResponse,
  SnapshotRequired,
  UserId,
} from "@calder/core";
import { SK, SK_PREFIX, calendarPk, padSeq } from "@calder/core";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { accessTo } from "./access.js";
import { client } from "./db.js";

/** Big enough that a normal catch-up is one request; small enough to fit. */
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;

export type ChangesResult =
  | { readonly ok: true; readonly body: ChangesResponse }
  | { readonly ok: false; readonly status: 404; readonly detail: string }
  | { readonly ok: false; readonly status: 410; readonly body: SnapshotRequired };

/**
 * Changes after `since`, or a 410 telling the client to start again.
 *
 * THE 410 IS NOT AN ERROR. A client that has been offline longer than the log's
 * 90 days has a watermark pointing at items the TTL has removed, and serving it
 * the changes that remain would silently skip everything in between — the one
 * outcome worse than a full resync, because nothing about it looks wrong.
 *
 * Detecting it is the useful part: the oldest surviving change tells you where
 * the log now begins, so a `since` older than that is exactly the case where
 * the answer cannot be trusted. A calendar with no changes at all is NOT that
 * case, which is why the emptiness check comes first.
 */
export async function changesSince(
  table: string,
  calendarId: CalendarId,
  actor: UserId,
  since: number,
  limit: number,
  db: DynamoDBDocumentClient = client(),
): Promise<ChangesResult> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) return { ok: false, status: 404, detail: access.detail };

  const capped = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const page = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": calendarPk(calendarId),
        // Exclusive lower bound, so a client that has seen seq 7 asks with
        // since=7 and is given 8 onwards. Padded, because these sort as
        // strings: "CHG#10" precedes "CHG#9" without it, and a client would
        // silently stop at nine changes forever.
        ":from": SK.change(since + 1),
        ":to": `${SK_PREFIX.change}${"9".repeat(padSeq(0).length)}`,
      },
      Limit: capped,
    }),
  );

  const items = (page.Items ?? []) as ChangeLogItem[];

  if (items.length === 0) {
    // Nothing after the watermark means the client is current. It cannot mean
    // "the log expired": if anything at all survived after `since` it would be
    // in this page, so an empty page is an empty tail.
    return { ok: true, body: { changes: [], nextSeq: since, hasMore: false } };
  }

  // THE GAP CHECK, and the reason it is here rather than on an empty result.
  //
  // Sequence numbers are gap-free by construction, so the first change after a
  // watermark of N is always N+1. Anything else means the ones in between are
  // gone — expired by the 90-day TTL, which is exactly the §5.2 case — and
  // serving what remains would silently skip them. Silently is the problem:
  // the client would carry on believing it was in sync, and nothing about the
  // response would look wrong.
  //
  // The naive version of this check asks whether the result is empty, and gets
  // it backwards: a client that has been away for a year has PLENTY of changes
  // after its watermark, all of them beginning after the hole.
  //
  // It is free. The alternative is a second query for the log's floor on every
  // sync, to learn something the first item already says.
  const first = items[0] as ChangeLogItem;
  if (first.seq > since + 1) {
    return {
      ok: false,
      status: 410,
      // NOT YET BUILT: there is no snapshot to point at, so this is empty and a
      // client receiving it can report the problem but cannot recover from it.
      // Bounded by the fact that it takes 90 days offline to reach, but it is a
      // hole in §5.2 and not a decision.
      body: { snapshotUrl: "", asOfSeq: first.seq },
    };
  }

  const changes: Change[] = items.map((item) => ({
    seq: item.seq,
    op: item.op,
    targetType: item.targetType,
    targetId: item.targetId,
    actorId: item.actorId,
    serverTs: item.serverTs,
    ...(item.op === "delete" || item.payload === undefined
      ? {}
      : { item: item.payload as AnyItem }),
  }));

  const last = changes[changes.length - 1];

  return {
    ok: true,
    body: {
      changes,
      nextSeq: last === undefined ? since : last.seq,
      // LastEvaluatedKey rather than comparing the count to the limit: the two
      // agree until a page ends exactly on the boundary, and then the count
      // says "done" while there is more.
      hasMore: page.LastEvaluatedKey !== undefined,
    },
  };
}
