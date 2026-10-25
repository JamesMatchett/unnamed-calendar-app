/**
 * Leaving, and being removed. The same write, with different permission (§8.4).
 *
 * A SOFT delete: the membership item stays so the person's name still resolves
 * on events they created, and the sparse index keys come off so the calendar
 * drops out of their list (§4.5, pattern 1). Existence is not permission, and
 * accessTo tests status rather than presence for exactly this reason.
 */

import type { CalendarId, Instant, MemberStatus, MembershipItem, UserId } from "@calder/core";
import { SK, SK_PREFIX, calendarPk, isOwner, leavingWouldOrphan } from "@calder/core";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { accessTo } from "./access.js";
import { client } from "./db.js";

type FailStatus = 400 | 403 | 404 | 409;

export type MemberResult =
  | { readonly ok: true; readonly membership: MembershipItem }
  | { readonly ok: false; readonly status: FailStatus; readonly detail: string };

/**
 * Take somebody out of a calendar.
 *
 * Yourself: leaving, unless you are the last owner, because a calendar with
 * no owner is unadministrable (§8.3) and the client already refuses to offer
 * it. Somebody else: removal, owners only, and never another owner, since
 * ownership is flat and demotion is a separate act (§8.3).
 *
 * `wasRemoved` persists across a rejoin, so a removed person is forced through
 * approval next time whatever the calendar's setting (§8.4). Leaving does not
 * set it; walking out is not being thrown out.
 */
export async function removeMember(
  table: string,
  calendarId: CalendarId,
  actor: UserId,
  userId: UserId,
  requested: unknown,
  now: Instant,
  db: DynamoDBDocumentClient = client(),
): Promise<MemberResult> {
  const access = await accessTo(table, calendarId, actor, db);
  if (!access.ok) return { ok: false, status: 404, detail: access.detail };

  const self = userId === actor;
  // The status the client asked for is accepted only when it matches what is
  // actually happening. A member cannot label their own departure a removal,
  // and an owner cannot record a removal as somebody leaving.
  const status: MemberStatus = self ? "left" : "removed";
  if (requested !== undefined && requested !== status) {
    return { ok: false, status: 400, detail: `this is a ${status}, not a ${String(requested)}` };
  }

  const page = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": calendarPk(calendarId), ":prefix": SK_PREFIX.member },
    }),
  );
  const members = (page.Items ?? []) as MembershipItem[];
  const target = members.find((m) => m.userId === userId);

  if (self) {
    if (leavingWouldOrphan(members, actor)) {
      return { ok: false, status: 409, detail: "the last owner cannot leave; hand over first" };
    }
  } else {
    if (!isOwner(access.membership)) {
      return { ok: false, status: 403, detail: "only an owner may remove somebody" };
    }
    if (target === undefined || target.status !== "active") {
      // Nothing to remove. Success, because the queue retries until it is.
      if (target !== undefined) return { ok: true, membership: target };
      return { ok: false, status: 404, detail: "not a member" };
    }
    if (isOwner(target)) {
      return { ok: false, status: 403, detail: "an owner cannot be removed; demote them first" };
    }
  }

  const done = await db.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: calendarPk(calendarId), SK: SK.member(userId) },
      // REMOVE the index keys: that is what takes the calendar out of their
      // list without deleting the row that resolves their name (§8.4).
      UpdateExpression:
        "SET #status = :status, #at = :now, #wasRemoved = :wasRemoved REMOVE GSI1PK, GSI1SK",
      ExpressionAttributeNames: {
        "#status": "status",
        "#at": self ? "leftAt" : "removedAt",
        "#wasRemoved": "wasRemoved",
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":now": now,
        ":wasRemoved": !self || target?.wasRemoved === true,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return { ok: true, membership: done.Attributes as MembershipItem };
}
