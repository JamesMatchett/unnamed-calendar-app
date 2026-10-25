/**
 * Events: create, edit, delete.
 *
 * The same shape as calendars.ts, on purpose: an idempotent create keyed by a
 * client-generated ULID, a versioned edit that can lose, and a delete. The
 * route shapes and the body shapes are the ones the mobile app has been
 * queueing since before this file existed, so this implements a contract with
 * callers rather than proposing one.
 *
 * THE BODY IS FLAT. The app stores an event as one SQLite row, so what it sends
 * is `startUtc`, `tz`, `locationName` and so on at the top level, while the
 * table item nests them as `time` and `location` (§4.3). The mapping happens
 * here and only here, so neither end has to know the other's shape.
 */

import type {
  CalendarId,
  EventId,
  EventItem,
  EventLocation,
  EventTime,
  Instant,
  RsvpItem,
  UserId,
} from "@calder/core";
import {
  GSI1_KEYS,
  SK,
  SK_PREFIX,
  calendarPk,
  canCreateEvent,
  canEditEventDirectly,
} from "@calder/core";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { accessTo } from "./access.js";
import { client } from "./db.js";

const isConditionFailure = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === "ConditionalCheckFailedException";

/**
 * What the app sends when it creates an event: its SQLite row, flattened.
 * Optional fields arrive as null as often as absent, because that is what a
 * nullable column reads back as.
 */
export interface NewEvent {
  readonly title: string;
  readonly description?: string | null;
  readonly startUtc: string;
  readonly endUtc?: string | null;
  readonly tz: string;
  readonly localWall: string;
  readonly precision: "datetime" | "date" | "tbc";
  readonly locationName?: string | null;
  readonly locationAddress?: string | null;
  readonly ticketsRequired?: boolean;
  readonly ticketUrl?: string | null;
  readonly allowSuggestions?: boolean;
  /**
   * Present when the create is retried after the event was cancelled offline:
   * the queue folds a cancel into a create that has not left the phone yet,
   * because a PATCH against an event the server has never seen would 404.
   */
  readonly status?: "active" | "cancelled";
  readonly imageKey?: string | null;
}

/** An edit is a create's fields, all optional, plus the version it was based on. */
export interface EventEdit extends Partial<NewEvent> {
  /** The version the client believes it is editing. Required (§5.4). */
  readonly version: number;
}

/** A fixed set of fields, or nothing, so a PATCH cannot invent attributes. */
const EDITABLE_FLAT = [
  "title",
  "description",
  "startUtc",
  "endUtc",
  "tz",
  "localWall",
  "precision",
  "locationName",
  "locationAddress",
  "ticketsRequired",
  "ticketUrl",
  "allowSuggestions",
  "status",
  "imageKey",
] as const;

type FailStatus = 400 | 403 | 404 | 409;

export type EventResult =
  | { readonly ok: true; readonly created: boolean; readonly event: EventItem }
  | { readonly ok: false; readonly status: FailStatus; readonly detail: string };

export type DeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: FailStatus; readonly detail: string };

const timeOf = (input: NewEvent): EventTime => ({
  startUtc: input.startUtc,
  tz: input.tz,
  localWall: input.localWall,
  precision: input.precision,
  ...(input.endUtc == null ? {} : { endUtc: input.endUtc }),
});

const locationOf = (input: NewEvent): EventLocation | undefined => {
  const name = input.locationName?.trim();
  if (name === undefined || name === "") return undefined;
  const address = input.locationAddress?.trim();
  return { name, ...(address === undefined || address === "" ? {} : { address }) };
};

/** Validation that is worth a 400 rather than a crash inside the SDK. */
function invalid(input: Partial<NewEvent>, creating: boolean): string | null {
  if (creating || input.title !== undefined) {
    if (typeof input.title !== "string" || input.title.trim() === "") return "title is required";
  }
  if (creating || input.startUtc !== undefined) {
    if (typeof input.startUtc !== "string" || Number.isNaN(Date.parse(input.startUtc))) {
      return "startUtc must be an ISO instant";
    }
  }
  if (input.endUtc != null && Number.isNaN(Date.parse(input.endUtc))) {
    return "endUtc must be an ISO instant";
  }
  if (creating || input.tz !== undefined) {
    if (typeof input.tz !== "string" || input.tz === "") return "tz is required";
  }
  if (creating || input.localWall !== undefined) {
    if (typeof input.localWall !== "string" || input.localWall === "") return "localWall is required";
  }
  if (creating || input.precision !== undefined) {
    if (input.precision !== "datetime" && input.precision !== "date" && input.precision !== "tbc") {
      return "precision must be datetime, date or tbc";
    }
  }
  if (input.status !== undefined && input.status !== "active" && input.status !== "cancelled") {
    return "status must be active or cancelled";
  }
  return null;
}

/**
 * Create an event, or notice it is already there.
 *
 * Like createCalendar, a repeat is the ordinary outcome and NOT an overwrite:
 * a queued create arriving after the event was edited on another device would
 * otherwise undo the edit. The client that needs to know can read `created`.
 */
export async function createEvent(
  table: string,
  calendarId: CalendarId,
  eventId: EventId,
  actor: UserId,
  input: NewEvent,
  now: Instant,
  db: DynamoDBDocumentClient = client(),
): Promise<EventResult> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) return { ok: false, status: 404, detail: access.detail };

  // A member adding to a curated calendar is a 403, not a 404: they can see
  // the calendar, so there is nothing to hide, and "you may not add events
  // here" is the answer that helps.
  if (!canCreateEvent(access.calendar, access.membership)) {
    return { ok: false, status: 403, detail: "members may not add events to this calendar" };
  }

  const problem = invalid(input, true);
  if (problem !== null) return { ok: false, status: 400, detail: problem };

  const location = locationOf(input);
  const description = input.description?.trim();
  const ticketUrl = input.ticketUrl?.trim();

  const event: EventItem = {
    PK: calendarPk(calendarId),
    SK: SK.event(eventId),
    entityType: "event",
    // No series yet: every event the app creates is a one-off, so it sorts in
    // the date window (pattern 4). The SERIES# prefix waits for rrule.
    ...GSI1_KEYS.eventAtTime(calendarId, input.startUtc, eventId),
    calendarId,
    eventId,
    title: input.title.trim(),
    time: timeOf(input),
    ticketsRequired: input.ticketsRequired === true,
    allowSuggestions: input.allowSuggestions !== false,
    status: input.status ?? "active",
    createdBy: actor,
    createdAt: now,
    lastUpdatedBy: actor,
    lastUpdatedAt: now,
    version: 1,
    ...(description === undefined || description === "" ? {} : { description }),
    ...(location === undefined ? {} : { location }),
    ...(ticketUrl === undefined || ticketUrl === "" ? {} : { ticketUrl }),
    ...(input.status === "cancelled" ? { cancelledAt: now, cancelledBy: actor } : {}),
  };

  try {
    await db.send(
      new PutCommand({
        TableName: table,
        Item: event,
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
    return { ok: true, created: true, event };
  } catch (cause) {
    if (!isConditionFailure(cause)) throw cause;
  }

  // Already there. Return what IS there rather than what was sent, so the
  // client reconciles to the truth instead of to its own retry.
  const existing = await db.send(
    new GetCommand({ TableName: table, Key: { PK: calendarPk(calendarId), SK: SK.event(eventId) } }),
  );
  return { ok: true, created: false, event: existing.Item as EventItem };
}

/**
 * Edit an event, refusing a stale write.
 *
 * Direct edits belong to the author and to owners; everyone else goes through
 * a suggestion (§8.1). A cancel is an edit that sets `status`, which keeps
 * cancel-then-delete (§8.2) to two routes rather than three.
 *
 * REMOVE rather than SET to null for a field the client has cleared. A nulled
 * attribute is still an attribute, and `attribute_exists(location)` would then
 * be true of an event with no location.
 */
export async function editEvent(
  table: string,
  calendarId: CalendarId,
  eventId: EventId,
  actor: UserId,
  edit: EventEdit,
  now: Instant,
  db: DynamoDBDocumentClient = client(),
): Promise<EventResult> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) return { ok: false, status: 404, detail: access.detail };

  const current = await db.send(
    new GetCommand({ TableName: table, Key: { PK: calendarPk(calendarId), SK: SK.event(eventId) } }),
  );
  const event = current.Item as EventItem | undefined;
  if (event === undefined) return { ok: false, status: 404, detail: "no such event" };

  if (!canEditEventDirectly(event, access.membership)) {
    return { ok: false, status: 403, detail: "only the author or an owner may edit this event" };
  }

  const problem = invalid(edit, false);
  if (problem !== null) return { ok: false, status: 400, detail: problem };

  // The time is one attribute, so any of its parts changing means rewriting
  // the whole thing from the merged view: what the client sent over what the
  // item already holds.
  const timeTouched = (["startUtc", "endUtc", "tz", "localWall", "precision"] as const).some(
    (k) => edit[k] !== undefined,
  );
  const merged: NewEvent = {
    title: edit.title ?? event.title,
    startUtc: edit.startUtc ?? event.time.startUtc,
    endUtc: edit.endUtc === undefined ? event.time.endUtc ?? null : edit.endUtc,
    tz: edit.tz ?? event.time.tz,
    localWall: edit.localWall ?? event.time.localWall,
    precision: edit.precision ?? event.time.precision,
    locationName: edit.locationName === undefined ? event.location?.name ?? null : edit.locationName,
    locationAddress:
      edit.locationAddress === undefined ? event.location?.address ?? null : edit.locationAddress,
  };

  const sets: string[] = ["#version = :next", "#lastUpdatedAt = :now", "#lastUpdatedBy = :actor"];
  const removes: string[] = [];
  const names: Record<string, string> = {
    "#version": "version",
    "#lastUpdatedAt": "lastUpdatedAt",
    "#lastUpdatedBy": "lastUpdatedBy",
  };
  const values: Record<string, unknown> = {
    ":next": edit.version + 1,
    ":expected": edit.version,
    ":now": now,
    ":actor": actor,
  };

  const set = (attribute: string, value: unknown): void => {
    sets.push(`#${attribute} = :${attribute}`);
    names[`#${attribute}`] = attribute;
    values[`:${attribute}`] = value;
  };
  const remove = (attribute: string): void => {
    removes.push(`#${attribute}`);
    names[`#${attribute}`] = attribute;
  };
  /** A nullable string: set when it has content, removed when cleared. */
  const setOrRemove = (attribute: string, value: string | null | undefined): void => {
    if (value === undefined) return;
    const trimmed = value?.trim();
    if (trimmed === undefined || trimmed === null || trimmed === "") remove(attribute);
    else set(attribute, trimmed);
  };

  if (edit.title !== undefined) set("title", edit.title.trim());
  setOrRemove("description", edit.description);
  setOrRemove("ticketUrl", edit.ticketUrl);
  if (edit.ticketsRequired !== undefined) set("ticketsRequired", edit.ticketsRequired === true);
  if (edit.allowSuggestions !== undefined) set("allowSuggestions", edit.allowSuggestions !== false);

  if (timeTouched) {
    set("time", timeOf(merged));
    // The date-window index key follows the start time, or the event stays
    // sorted where it used to be and a moved event vanishes from the week it
    // moved to.
    set("GSI1SK", GSI1_KEYS.eventAtTime(calendarId, merged.startUtc, eventId).GSI1SK);
  }
  if (edit.locationName !== undefined || edit.locationAddress !== undefined) {
    const location = locationOf(merged);
    if (location === undefined) remove("location");
    else set("location", location);
  }
  if (edit.status !== undefined && edit.status !== event.status) {
    set("status", edit.status);
    if (edit.status === "cancelled") {
      set("cancelledAt", now);
      set("cancelledBy", actor);
    } else {
      remove("cancelledAt");
      remove("cancelledBy");
    }
  }

  const expression =
    `SET ${sets.join(", ")}` + (removes.length === 0 ? "" : ` REMOVE ${removes.join(", ")}`);

  try {
    const done = await db.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: calendarPk(calendarId), SK: SK.event(eventId) },
        UpdateExpression: expression,
        ConditionExpression: "#version = :expected",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return { ok: true, created: false, event: done.Attributes as EventItem };
  } catch (cause) {
    if (!isConditionFailure(cause)) throw cause;
    return {
      ok: false,
      status: 409,
      detail: `event has moved on from version ${edit.version}`,
    };
  }
}

/**
 * Delete an event, and every answer to it.
 *
 * A hard delete rather than a tombstone: the stream turns the REMOVE into a
 * `delete` change (§5.1), which is the tombstone as far as a syncing client is
 * concerned, and it lives in the change log for the same 90 days a tombstone
 * item would. One mechanism instead of two.
 *
 * The RSVPs go too. They sort under their own prefix in the same partition, so
 * finding them is one Query, and leaving them would hand every syncing client
 * an answer to an event it no longer has.
 *
 * Cancel-first (§8.2) is NOT enforced here. It is a rule about what the UI
 * offers, kept in @calder/core as deleteStep, and the one case that
 * legitimately skips it, a calendar with nobody else in it, is one only the
 * client can see cheaply. Permission is the server's business; ceremony is not.
 */
export async function deleteEvent(
  table: string,
  calendarId: CalendarId,
  eventId: EventId,
  actor: UserId,
  db: DynamoDBDocumentClient = client(),
): Promise<DeleteResult> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) return { ok: false, status: 404, detail: access.detail };

  const current = await db.send(
    new GetCommand({ TableName: table, Key: { PK: calendarPk(calendarId), SK: SK.event(eventId) } }),
  );
  const event = current.Item as EventItem | undefined;
  // Already gone is success: the client retries this forever, and the second
  // attempt finding nothing is exactly what the first attempt working looks
  // like from the queue's point of view.
  if (event === undefined) return { ok: true };

  if (!canEditEventDirectly(event, access.membership)) {
    return { ok: false, status: 403, detail: "only the author or an owner may delete this event" };
  }

  const answers = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": calendarPk(calendarId),
        ":prefix": SK_PREFIX.rsvpForEvent(eventId),
      },
      ProjectionExpression: "SK",
    }),
  );

  const keys = ((answers.Items ?? []) as Pick<RsvpItem, "SK">[]).map((item) => ({
    PK: calendarPk(calendarId),
    SK: item.SK,
  }));
  // Twenty-five is BatchWrite's ceiling. The answers first, the event last, so
  // a failure part-way leaves an event with fewer answers rather than answers
  // to no event.
  for (let i = 0; i < keys.length; i += 25) {
    await db.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
        },
      }),
    );
  }

  await db.send(
    new DeleteCommand({ TableName: table, Key: { PK: calendarPk(calendarId), SK: SK.event(eventId) } }),
  );
  return { ok: true };
}

export { EDITABLE_FLAT };
