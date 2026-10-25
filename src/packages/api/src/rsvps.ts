/**
 * RSVPs: answer, withdraw, and say where you stand on a ticket.
 *
 * The showcase interaction of §5.6 is an RSVP in a basement with no signal, and
 * what makes it safe to queue is that an answer cannot conflict (§5.4): the key
 * carries the user id, so two people answering at once write two items, and
 * one person answering twice writes the same item twice. No version, no
 * ConditionExpression, last write wins because the last write IS the answer.
 *
 * The caller answers for THEMSELVES, always. The user id in the key is the
 * token's, never one from the body, which is what stops a member marking
 * somebody else as going.
 */

import type {
  CalendarId,
  EventId,
  EventItem,
  Instant,
  RsvpItem,
  RsvpStatus,
  TicketStatus,
  UserId,
} from "@calder/core";
import { GSI1_KEYS, SERIES_DEFAULT, SK, calendarPk, isActiveMember } from "@calder/core";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { accessTo } from "./access.js";
import { client } from "./db.js";

type FailStatus = 400 | 404;

export type RsvpResult =
  | { readonly ok: true; readonly rsvp: RsvpItem }
  | { readonly ok: false; readonly status: FailStatus; readonly detail: string };

export type ClearResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: FailStatus; readonly detail: string };

const STATUSES: readonly RsvpStatus[] = ["going", "maybe", "not_going"];
const TICKETS: readonly TicketStatus[] = ["have", "looking", "none"];

/**
 * The occurrence the client named, or the series default.
 *
 * `-` is what every one-off event uses (§5.5), and it is also what the client
 * sends when it has nothing more specific to say. Anything else must parse as
 * an instant, because it is going into a key.
 */
function occurrenceOf(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "" || raw === SERIES_DEFAULT) {
    return SERIES_DEFAULT;
  }
  if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

/**
 * The event, if the caller may see it.
 *
 * Membership is checked by accessTo; this adds the one thing an RSVP needs on
 * top, which is that the event exists. An answer to nothing is not an error
 * the client can act on, so it is a 404 like any other missing thing.
 */
async function eventFor(
  table: string,
  calendarId: CalendarId,
  eventId: EventId,
  actor: UserId,
  db: DynamoDBDocumentClient,
): Promise<{ ok: true; event: EventItem } | { ok: false; status: 404; detail: string }> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) return { ok: false, status: 404, detail: access.detail };
  // Belt and braces: accessTo has already established this, and the predicate
  // is cheap enough that restating the rule costs nothing.
  if (!isActiveMember(access.membership)) {
    return { ok: false, status: 404, detail: "not a member" };
  }
  const got = await db.send(
    new GetCommand({ TableName: table, Key: { PK: calendarPk(calendarId), SK: SK.event(eventId) } }),
  );
  const event = got.Item as EventItem | undefined;
  if (event === undefined) return { ok: false, status: 404, detail: "no such event" };
  return { ok: true, event };
}

/**
 * Answer, or change an answer.
 *
 * A plain Put. The item IS the answer, so writing it again with a different
 * status is the edit, and writing it again with the same status is the retry.
 * The previous ticket status is kept, because changing from maybe to going is
 * not a statement about tickets.
 */
export async function putRsvp(
  table: string,
  calendarId: CalendarId,
  eventId: EventId,
  actor: UserId,
  body: { readonly occurrence?: unknown; readonly status?: unknown },
  now: Instant,
  db: DynamoDBDocumentClient = client(),
): Promise<RsvpResult> {
  const found = await eventFor(table, calendarId, eventId, actor, db);
  if (!found.ok) return found;

  const occurrence = occurrenceOf(body.occurrence);
  if (occurrence === null) return { ok: false, status: 400, detail: "occurrence must be an instant or -" };
  if (!STATUSES.includes(body.status as RsvpStatus)) {
    return { ok: false, status: 400, detail: "status must be going, maybe or not_going" };
  }

  const key = { PK: calendarPk(calendarId), SK: SK.rsvp(eventId, occurrence, actor) };
  const previous = (await db.send(new GetCommand({ TableName: table, Key: key }))).Item as
    | RsvpItem
    | undefined;

  const rsvp: RsvpItem = {
    ...key,
    entityType: "rsvp",
    // Pattern 13: my upcoming events across every calendar, sorted by when.
    ...GSI1_KEYS.rsvp(actor, found.event.time.startUtc, calendarId),
    calendarId,
    eventId,
    userId: actor,
    occurrence,
    status: body.status as RsvpStatus,
    respondedAt: now,
    ...(previous?.ticketStatus == null ? {} : { ticketStatus: previous.ticketStatus }),
  };

  await db.send(new PutCommand({ TableName: table, Item: rsvp }));
  return { ok: true, rsvp };
}

/**
 * Withdraw an answer. Back to "hasn't replied", which the tally counts
 * separately from "not going" (§3.5). Already absent is success.
 */
export async function clearRsvp(
  table: string,
  calendarId: CalendarId,
  eventId: EventId,
  actor: UserId,
  body: { readonly occurrence?: unknown },
  db: DynamoDBDocumentClient = client(),
): Promise<ClearResult> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) return { ok: false, status: 404, detail: access.detail };

  const occurrence = occurrenceOf(body.occurrence);
  if (occurrence === null) return { ok: false, status: 400, detail: "occurrence must be an instant or -" };

  await db.send(
    new DeleteCommand({
      TableName: table,
      Key: { PK: calendarPk(calendarId), SK: SK.rsvp(eventId, occurrence, actor) },
    }),
  );
  return { ok: true };
}

/**
 * Where somebody stands on getting in.
 *
 * Saying you have a ticket is saying you are going, so an answer is created as
 * `going` when there was none, which is also what the app does locally. An
 * existing answer keeps its status: "I'm still only a maybe but I have a
 * ticket" is a real thing to say.
 */
export async function setTicket(
  table: string,
  calendarId: CalendarId,
  eventId: EventId,
  actor: UserId,
  body: { readonly occurrence?: unknown; readonly ticketStatus?: unknown },
  now: Instant,
  db: DynamoDBDocumentClient = client(),
): Promise<RsvpResult> {
  const found = await eventFor(table, calendarId, eventId, actor, db);
  if (!found.ok) return found;

  const occurrence = occurrenceOf(body.occurrence);
  if (occurrence === null) return { ok: false, status: 400, detail: "occurrence must be an instant or -" };
  const ticket = body.ticketStatus;
  if (ticket !== null && !TICKETS.includes(ticket as TicketStatus)) {
    return { ok: false, status: 400, detail: "ticketStatus must be have, looking, none or null" };
  }

  const key = { PK: calendarPk(calendarId), SK: SK.rsvp(eventId, occurrence, actor) };
  const previous = (await db.send(new GetCommand({ TableName: table, Key: key }))).Item as
    | RsvpItem
    | undefined;

  const rsvp: RsvpItem = {
    ...key,
    entityType: "rsvp",
    ...GSI1_KEYS.rsvp(actor, found.event.time.startUtc, calendarId),
    calendarId,
    eventId,
    userId: actor,
    occurrence,
    status: previous?.status ?? "going",
    respondedAt: previous?.respondedAt ?? now,
    ...(ticket === null ? {} : { ticketStatus: ticket as TicketStatus }),
  };

  await db.send(new PutCommand({ TableName: table, Item: rsvp }));
  return { ok: true, rsvp };
}
