/**
 * May this caller touch this calendar?
 *
 * One place, asked before every handler that names a calendar id, because §4.5
 * is a rule about the SYSTEM rather than about any one route: a check written
 * per handler is a check that will one day be forgotten in a handler, and the
 * failure is silent and total.
 *
 * The predicates themselves live in @calder/core so the app and the API cannot
 * disagree about who may do what. Nothing here re-implements them; this only
 * fetches the two items they need.
 */

import type { CalendarId, CalendarItem, MembershipItem, UserId } from "@calder/core";
import { SK, calendarPk, isActiveMember } from "@calder/core";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { client } from "./db.js";

export interface Granted {
  readonly ok: true;
  readonly calendar: CalendarItem;
  readonly membership: MembershipItem;
}

export interface Denied {
  readonly ok: false;
  readonly status: 404;
  readonly detail: string;
}

export type Access = Granted | Denied;

/**
 * 404 FOR BOTH "no such calendar" AND "not yours".
 *
 * Answering 403 for the second would confirm that an id exists to anybody who
 * asks, which turns an unguessable id into a guessable one given a list. The
 * ids are ULIDs and the leak is weak, but the cost of not leaking is one
 * status code, and the version of this that distinguishes them is the version
 * somebody quotes in a bug report about a calendar they should not know about.
 *
 * `detail` differs internally so the logs can still tell them apart. It is not
 * returned to the caller.
 */
export async function accessTo(
  table: string,
  calendarId: CalendarId,
  userId: UserId,
  db: DynamoDBDocumentClient = client(),
): Promise<Access> {
  // In parallel: they are two items in the same partition, and waiting for the
  // first before asking for the second doubles the latency of every authorised
  // request in the API for no benefit.
  const [meta, member] = await Promise.all([
    db.send(
      new GetCommand({
        TableName: table,
        Key: { PK: calendarPk(calendarId), SK: SK.meta() },
      }),
    ),
    db.send(
      new GetCommand({
        TableName: table,
        Key: { PK: calendarPk(calendarId), SK: SK.member(userId) },
      }),
    ),
  ]);

  const calendar = meta.Item as CalendarItem | undefined;
  if (calendar === undefined) {
    return { ok: false, status: 404, detail: "no such calendar" };
  }

  // A soft-deleted calendar is gone as far as every route is concerned. It
  // survives for 30 days so it can be restored (§8.5), not so it can be read.
  if (calendar.status === "deleted") {
    return { ok: false, status: 404, detail: "calendar is deleted" };
  }

  const membership = member.Item as MembershipItem | undefined;

  // isActiveMember rather than a presence test. Membership items are soft
  // deleted so a departed member's name still resolves on events they created,
  // which means existence is NOT permission — testing for the item instead of
  // its status would leave every person who ever left with full access.
  if (!isActiveMember(membership)) {
    return {
      ok: false,
      status: 404,
      detail:
        membership === undefined
          ? "not a member"
          : `membership is ${membership.status}`,
    };
  }

  // isActiveMember has already established this is not undefined; TypeScript
  // cannot see through a predicate that takes a union with undefined.
  return { ok: true, calendar, membership: membership as MembershipItem };
}
