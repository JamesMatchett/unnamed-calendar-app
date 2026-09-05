/**
 * The change log: turning writes into an ordered, replayable feed (§5.1).
 *
 * WHY THE STREAM ASSIGNS THE SEQUENCE and not the write path. A client's write
 * stays one round trip, and ordering comes out gap-free without anybody taking
 * a lock: DynamoDB Streams deliver records for a partition key in order, and a
 * calendar IS a partition key, so "ordered per calendar" is a property of the
 * table rather than something this code has to arrange.
 *
 * That is also why the counter must not live on the calendar's META item.
 * Incrementing it would write to META, which produces a stream record, which
 * arrives here, which looks like a calendar edit and gets a sequence number of
 * its own, which increments the counter again. Its own item, and this consumer
 * ignores both that item and the change items it writes. Those two skips are
 * the difference between a change log and a runaway loop, so they are asserted
 * in the tests rather than left to review.
 */

import type { CalendarId, ChangeLogItem, ChangeOp, EntityType, UserId } from "@calder/core";
import {
  RETENTION_DAYS,
  SK,
  SK_PREFIX,
  calendarPk,
  daysFromNow,
} from "@calder/core";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import { client } from "./db.js";

/** The part of a DynamoDB stream event this reads. Declared, not imported. */
export interface StreamEvent {
  readonly Records?: readonly StreamRecord[];
}

export interface StreamRecord {
  readonly eventID?: string;
  readonly eventName?: "INSERT" | "MODIFY" | "REMOVE";
  readonly dynamodb?: {
    readonly Keys?: Record<string, unknown>;
    readonly NewImage?: Record<string, unknown>;
    readonly OldImage?: Record<string, unknown>;
  };
}

/** Partial batch failure: everything before the first failure stays done. */
export interface BatchResponse {
  readonly batchItemFailures: { readonly itemIdentifier: string }[];
}

const CALENDAR_PREFIX = "CAL#";

/**
 * Whether a record describes a change worth logging.
 *
 * Exported because it is the loop guard, and a guard nobody can test is a
 * guard nobody trusts.
 */
export function isLoggable(pk: string | undefined, sk: string | undefined): boolean {
  if (pk === undefined || sk === undefined) return false;
  // Only calendars have a change feed. Users, identities and invites live in
  // their own partitions and nobody syncs them this way.
  if (!pk.startsWith(CALENDAR_PREFIX)) return false;
  // Our own writes. Logging either of these is the runaway loop.
  if (sk === SK.seqCounter()) return false;
  if (sk.startsWith(SK_PREFIX.change)) return false;
  return true;
}

/**
 * Put or delete, with no separate "create".
 *
 * INSERT and MODIFY collapse into one because the client applies a change as an
 * upsert either way, and a client that missed the INSERT — which is the whole
 * point of a change log — would be unable to act on an "update" for a row it
 * has never seen. Two ops, both of which any client can always apply.
 */
const opFor = (eventName: string | undefined): ChangeOp =>
  eventName === "REMOVE" ? "delete" : "put";

/**
 * The next sequence number for a calendar.
 *
 * ADD on a single attribute, which is atomic in DynamoDB whatever else is
 * happening, so this is correct even though the consumer may run concurrently
 * across shards. It cannot skip and it cannot repeat.
 */
async function nextSeq(
  table: string,
  calendarId: CalendarId,
  db: DynamoDBDocumentClient,
): Promise<number> {
  const done = await db.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: calendarPk(calendarId), SK: SK.seqCounter() },
      UpdateExpression: "ADD lastSeq :one",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  const seq = (done.Attributes as { lastSeq?: number } | undefined)?.lastSeq;
  if (typeof seq !== "number") {
    throw new Error(`sequence counter for ${calendarId} did not return a number`);
  }
  return seq;
}

/**
 * One record to one change item.
 *
 * The whole new image rides in `payload` so a syncing client can apply the
 * change as an upsert without a second request per change. For a delete there
 * is no new image, and the old one carries what the client needs to remove.
 */
export async function logOne(
  table: string,
  record: StreamRecord,
  now: string,
  db: DynamoDBDocumentClient = client(),
): Promise<ChangeLogItem | null> {
  const keys = record.dynamodb?.Keys;
  if (keys === undefined) return null;

  const { PK, SK: sk } = unmarshall(keys as never) as { PK?: string; SK?: string };
  if (!isLoggable(PK, sk)) return null;

  const image = record.dynamodb?.NewImage ?? record.dynamodb?.OldImage;
  const entity = image === undefined ? undefined : (unmarshall(image as never) as Record<string, unknown>);

  const calendarId = (PK as string).slice(CALENDAR_PREFIX.length) as CalendarId;
  const seq = await nextSeq(table, calendarId, db);

  const change: ChangeLogItem = {
    PK: calendarPk(calendarId),
    SK: SK.change(seq),
    entityType: "change",
    calendarId,
    seq,
    op: opFor(record.eventName),
    targetType: (entity?.["entityType"] as EntityType | undefined) ?? "calendar",
    targetId: sk as string,
    // Server-stamped, never the client's clock (§5.4). The client's own
    // timestamps are data; they are not ordering.
    actorId: (entity?.["lastUpdatedBy"] as UserId | undefined) ??
      (entity?.["userId"] as UserId | undefined) ??
      (entity?.["createdBy"] as UserId | undefined) ??
      ("" as UserId),
    serverTs: now,
    expiresAt: daysFromNow(RETENTION_DAYS.changeLog),
    ...(entity === undefined ? {} : { payload: entity }),
  };

  await db.send(new PutCommand({ TableName: table, Item: change }));
  return change;
}

/**
 * The Lambda entry point.
 *
 * Sequential, not Promise.all: the ordering this whole design rests on is the
 * order the records arrive in, and racing them would throw it away for a
 * latency saving nobody is waiting on.
 *
 * DUPLICATES ARE POSSIBLE and that is a deliberate trade. Reporting partial
 * failures means a retry resumes at the first record that failed rather than
 * replaying the batch, but a record that was written and then failed to be
 * acknowledged can still be logged twice under two sequence numbers. The client
 * applies changes as upserts keyed by entity id, so a duplicate is a wasted
 * write rather than a wrong one. Making it exactly-once would mean a
 * conditional write keyed on the stream record id, which is a second item per
 * change to save a rare redundant one.
 */
export const changeLog = async (event: StreamEvent): Promise<BatchResponse> => {
  const table = process.env["CALDER_TABLE"] ?? "";
  const now = new Date().toISOString();
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records ?? []) {
    try {
      await logOne(table, record, now);
    } catch (cause) {
      // Everything from here on is retried, so stop rather than carrying on
      // and logging later changes ahead of an earlier one.
      if (record.eventID !== undefined) {
        failures.push({ itemIdentifier: record.eventID });
      }
      console.error("change log failed", { eventID: record.eventID, cause });
      break;
    }
  }

  return { batchItemFailures: failures };
};
