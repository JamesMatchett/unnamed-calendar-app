/**
 * Calendars: create, list, read, edit.
 *
 * The first entity taken all the way through, and deliberately so — it is the
 * simplest one that still touches every hard part: an idempotent write from a
 * client that may be offline, a sparse-index list, a versioned edit that can
 * conflict, and a soft delete. Members, events and RSVPs repeat this shape
 * rather than inventing their own.
 *
 * The route SHAPES are not chosen here. The mobile app has been queueing
 * mutations against `PUT /v1/calendars/{cid}` since long before this file
 * existed, with a client-generated ULID in the path, so this implements a
 * contract that already has callers rather than proposing a new one.
 */

import type {
  CalendarId,
  CalendarItem,
  Instant,
  MembershipItem,
  UserId,
} from "@calder/core";
import {
  GSI1,
  GSI1_SK_PREFIX,
  GSI1_KEYS,
  KEY_PREFIX,
  RETENTION_DAYS,
  SK,
  calendarPk,
  daysFromNow,
  isOwner,
  userPk,
} from "@calder/core";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { accessTo } from "./access.js";
import { client } from "./db.js";

/** ConditionExpression failures arrive as this, and are ordinary here. */
const isConditionFailure = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === "ConditionalCheckFailedException";

/** What a client may set when it creates a calendar. Everything else is ours. */
export interface NewCalendar {
  readonly name: string;
  readonly mode: "bounded" | "continuous";
  readonly startDate?: string;
  readonly endDate?: string;
  readonly defaultTz: string;
  readonly collectAvailability: boolean;
  readonly allowMemberEvents: boolean;
  readonly travelMode: string;
  readonly isPrivate: boolean;
  readonly coverImage?: string | null;
}

export interface Created {
  readonly created: boolean;
  readonly calendar: CalendarItem;
}

/**
 * Create a calendar, or notice it is already there.
 *
 * TWO CONDITIONAL WRITES RATHER THAN A TRANSACTION, which needs saying because
 * §8.3 is emphatic that a calendar with no owner is unadministrable and the two
 * items should never be separate writes.
 *
 * They are still never separately DECIDED: this is one idempotent operation
 * that the client retries until it succeeds, exactly as it retries any queued
 * mutation (§5.3), and each half is conditional so a retry is free. The meta
 * item goes first, so the failure window leaves a calendar nobody can see —
 * invisible and harmless — rather than a membership pointing at nothing, which
 * would put a broken row in somebody's list.
 *
 * The reason it is not TransactWriteItems is that the test engine does not
 * implement it, and an untested create path on the one operation that must not
 * half-happen is worse than a tested two-step whose failure mode is documented
 * and self-healing. identity.ts made the same call for the same reason.
 */
export async function createCalendar(
  table: string,
  calendarId: CalendarId,
  actor: UserId,
  displayName: string,
  input: NewCalendar,
  now: Instant,
  db: DynamoDBDocumentClient = client(),
): Promise<Created> {
  const calendar: CalendarItem = {
    PK: calendarPk(calendarId),
    SK: SK.meta(),
    entityType: "calendar",
    calendarId,
    name: input.name,
    mode: input.mode,
    defaultTz: input.defaultTz,
    collectAvailability: input.collectAvailability,
    travelMode: input.travelMode as CalendarItem["travelMode"],
    requireApproval: true,
    allowMemberInvites: false,
    allowMemberEvents: input.allowMemberEvents,
    icsToken: "",
    status: "active",
    createdBy: actor,
    createdAt: now,
    version: 1,
    updatedAt: now,
    lastUpdatedBy: actor,
    ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
    ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
    ...(input.coverImage == null ? {} : { coverImageUrl: input.coverImage }),
  } as CalendarItem;

  let created = true;
  try {
    await db.send(
      new PutCommand({
        TableName: table,
        Item: calendar,
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (cause) {
    if (!isConditionFailure(cause)) throw cause;
    // Already there, which on a queue that retries forever is the ORDINARY
    // outcome rather than an error. Fall through to the membership write: the
    // whole point of doing it again is to finish a create that stopped halfway.
    created = false;
  }

  const membership: MembershipItem = {
    PK: calendarPk(calendarId),
    SK: SK.member(actor),
    entityType: "membership",
    ...GSI1_KEYS.membership(actor, calendarId),
    calendarId,
    userId: actor,
    role: "owner",
    status: "active",
    displayName,
    joinedAt: now,
    wasRemoved: false,
    lastSeenSeq: 0,
    notifyMuted: false,
  };

  try {
    await db.send(
      new PutCommand({
        TableName: table,
        Item: membership,
        ConditionExpression: "attribute_not_exists(SK)",
      }),
    );
  } catch (cause) {
    if (!isConditionFailure(cause)) throw cause;
    // The creator is already a member. Nothing to do, and in particular do NOT
    // overwrite: a retry arriving after they were demoted or left must not
    // quietly restore them to owner.
  }

  return { created, calendar };
}

/**
 * Access pattern 1: which calendars am I in?
 *
 * Returns IDS, and only ids, which is not a shortcut — it is what the index can
 * honestly answer. GSI1 is an INCLUDE projection with a deliberately narrow
 * attribute list (§4.2: a fat projection is how a DynamoDB bill doubles
 * quietly), and `role`, `joinedAt` and `lastSeenSeq` are not in it. A query
 * that read them would compile, pass review, and return undefined for every
 * one of them in production. The test suite caught exactly that.
 *
 * Widening the projection would fix it and cost a write on every indexed item
 * forever, and replace the index to do it. Not needed: the membership item
 * lives in the calendar's own partition, so it arrives through the change feed
 * with everything on it. This endpoint answers "which calendars", the feed
 * answers "and what is in them", and neither duplicates the other.
 *
 * The id itself comes from GSI1SK rather than an attribute, because the key is
 * always there by definition — it is what made the row appear in the index.
 *
 * Departed and removed memberships carry no GSI1 keys at all, so leaving a
 * calendar removes it from this list without deleting the item that still
 * resolves the person's name on events they created (§8.4). There is no status
 * test in this function because the sparse index has already done it.
 */
export async function listCalendars(
  table: string,
  actor: UserId,
  db: DynamoDBDocumentClient = client(),
): Promise<CalendarId[]> {
  const out: CalendarId[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const page = await db.send(
      new QueryCommand({
        TableName: table,
        IndexName: GSI1,
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": userPk(actor),
          ":prefix": GSI1_SK_PREFIX.calendarsForUser,
        },
        // Only the keys are read, so nothing here can come to depend on an
        // attribute the projection does not carry.
        ProjectionExpression: "GSI1SK",
        ...(cursor === undefined ? {} : { ExclusiveStartKey: cursor }),
      }),
    );

    for (const item of (page.Items ?? []) as { GSI1SK?: string }[]) {
      if (item.GSI1SK === undefined) continue;
      out.push(item.GSI1SK.slice(KEY_PREFIX.calendar.length) as CalendarId);
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor !== undefined);

  return out;
}

export type EditResult =
  | { readonly ok: true; readonly calendar: CalendarItem }
  | { readonly ok: false; readonly status: 404 | 403 | 409; readonly detail: string };

/** The settings an owner may change after the fact. */
export interface CalendarEdit {
  readonly name?: string;
  readonly collectAvailability?: boolean;
  readonly allowMemberEvents?: boolean;
  readonly allowMemberInvites?: boolean;
  readonly requireApproval?: boolean;
  readonly coverImage?: string | null;
  /** The version the client believes it is editing. Required (§5.4). */
  readonly version: number;
}

const EDITABLE = {
  name: "name",
  collectAvailability: "collectAvailability",
  allowMemberEvents: "allowMemberEvents",
  allowMemberInvites: "allowMemberInvites",
  requireApproval: "requireApproval",
  coverImage: "coverImageUrl",
} as const;

/**
 * Edit settings, refusing a stale write.
 *
 * The ConditionExpression on `version` is the whole mechanism from §5.4, and it
 * is cheap enough that skipping it would only ever be laziness: two owners
 * editing at once is a real path, because ownership is flat and any owner may
 * change anything. Without this the second write wins silently and the first
 * owner's change is gone with nothing to show it ever happened.
 */
export async function editCalendar(
  table: string,
  calendarId: CalendarId,
  actor: UserId,
  edit: CalendarEdit,
  now: Instant,
  db: DynamoDBDocumentClient = client(),
): Promise<EditResult> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) return { ok: false, status: 404, detail: access.detail };

  // Settings belong to owners. A member editing them is a 403 rather than a
  // 404: they can see the calendar, so there is nothing to hide by pretending
  // it is absent, and "you are not an owner" is the answer that helps.
  if (!isOwner(access.membership)) {
    return { ok: false, status: 403, detail: "only an owner may change settings" };
  }

  const sets: string[] = ["#version = :next", "#updatedAt = :now", "#lastUpdatedBy = :actor"];
  const names: Record<string, string> = {
    "#version": "version",
    "#updatedAt": "updatedAt",
    "#lastUpdatedBy": "lastUpdatedBy",
  };
  const values: Record<string, unknown> = {
    ":next": edit.version + 1,
    ":expected": edit.version,
    ":now": now,
    ":actor": actor,
  };

  for (const [field, attribute] of Object.entries(EDITABLE)) {
    const value = edit[field as keyof typeof EDITABLE];
    if (value === undefined) continue;
    sets.push(`#${attribute} = :${attribute}`);
    names[`#${attribute}`] = attribute;
    values[`:${attribute}`] = value;
  }

  try {
    const done = await db.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: calendarPk(calendarId), SK: SK.meta() },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "#version = :expected",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return { ok: true, calendar: done.Attributes as CalendarItem };
  } catch (cause) {
    if (!isConditionFailure(cause)) throw cause;
    // Somebody else got there first. 409 rather than an overwrite, and the
    // client re-syncs and re-applies rather than being told it succeeded.
    return {
      ok: false,
      status: 409,
      detail: `calendar has moved on from version ${edit.version}`,
    };
  }
}

export type DeleteCalendarResult =
  | { readonly ok: true; readonly calendar: CalendarItem }
  | { readonly ok: false; readonly status: 403 | 404; readonly detail: string };

/**
 * Delete a calendar, for everyone in it.
 *
 * A status change rather than a removal, restorable for thirty days (§8.5): the
 * META item takes `status: deleted`, a `deletedAt`, and an `expiresAt` thirty
 * days out, so the table's TTL does the eventual removal and nothing here has
 * to. Every other item in the partition stays where it is; accessTo answers
 * 404 for a deleted calendar, which is what makes them unreachable.
 *
 * The one write that is NOT a version check. A delete is not an edit that can
 * be stale: whichever version an owner was looking at, deleting it is what
 * they meant. Already deleted is success, because the queue retries until it
 * is.
 */
export async function deleteCalendar(
  table: string,
  calendarId: CalendarId,
  actor: UserId,
  now: Instant,
  db: DynamoDBDocumentClient = client(),
): Promise<DeleteCalendarResult> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) {
    // accessTo cannot tell "deleted" from "not yours" to a caller, but it can
    // to us, and a retry of a delete that already happened must succeed.
    if (access.detail === "calendar is deleted") {
      const gone = await db.send(
        new GetCommand({ TableName: table, Key: { PK: calendarPk(calendarId), SK: SK.meta() } }),
      );
      return { ok: true, calendar: gone.Item as CalendarItem };
    }
    return { ok: false, status: 404, detail: access.detail };
  }
  if (!isOwner(access.membership)) {
    return { ok: false, status: 403, detail: "only an owner may delete a calendar" };
  }

  const done = await db.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: calendarPk(calendarId), SK: SK.meta() },
      UpdateExpression:
        "SET #status = :deleted, #deletedAt = :now, #expiresAt = :expires, " +
        "#updatedAt = :now, #lastUpdatedBy = :actor, #version = #version + :one",
      ExpressionAttributeNames: {
        "#status": "status",
        "#deletedAt": "deletedAt",
        "#expiresAt": "expiresAt",
        "#updatedAt": "updatedAt",
        "#lastUpdatedBy": "lastUpdatedBy",
        "#version": "version",
      },
      ExpressionAttributeValues: {
        ":deleted": "deleted",
        ":now": now,
        ":expires": daysFromNow(RETENTION_DAYS.deletedCalendar),
        ":actor": actor,
        ":one": 1,
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return { ok: true, calendar: done.Attributes as CalendarItem };
}
