import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

import {
  GSI1_KEYS,
  SERIES_DEFAULT,
  SK,
  calendarPk,
  identityPk,
  invitePk,
  padSeq,
  pendingInvitePk,
  userPk,
} from "@calder/core";
import { TABLE } from "./table.mjs";

/**
 * One plausible weekend's worth of data, built entirely through the key
 * builders in @calder/core.
 *
 * Nothing here concatenates a key by hand. That is the point: if a builder is
 * wrong, the seed is wrong in the same way as production would be, and the
 * queries below fail — which is what makes this a test of the schema rather
 * than a test of the strings this file happens to contain.
 */

export const JAMES = "01USERJAMES00000000000000";
export const LUKE = "01USERLUKE000000000000000";
export const PRIYA = "01USERPRIYA00000000000000";

export const TRIP = "01CALTRIP0000000000000000";
export const HOME = "01CALHOME0000000000000000";

export const DINNER = "01EVDINNER000000000000000";
export const FLIGHT = "01EVFLIGHT000000000000000";
export const STANDUP = "01EVSTANDUP00000000000000";

export const SUGGESTION = "01SUGG0000000000000000000";

/** Two events inside a Friday-to-Sunday window, one well outside it. */
export const DINNER_AT = "2026-10-02T18:30:00.000Z";
export const FLIGHT_AT = "2026-10-02T07:15:00.000Z";
export const CHRISTMAS_AT = "2026-12-25T12:00:00.000Z";

export const INVITE_HASH = "a".repeat(64);
export const EMAIL_HASH = "b".repeat(64);
export const SUB = "apple-000-111";

const entity = (type, extra = {}) => ({ entityType: type, updatedAt: "2026-09-05T12:00:00.000Z", ...extra });

export function items() {
  return [
    // --- the trip calendar ------------------------------------------------
    { PK: calendarPk(TRIP), SK: SK.meta(), ...entity("calendar", { name: "Lisbon" }) },

    // Membership carries GSI1 so that "which calendars am I in" is a query on
    // the index rather than a scan (pattern 1).
    {
      PK: calendarPk(TRIP), SK: SK.member(JAMES),
      ...GSI1_KEYS.membership(JAMES, TRIP),
      ...entity("member", { name: "James", status: "active" }),
    },
    {
      PK: calendarPk(TRIP), SK: SK.member(LUKE),
      ...GSI1_KEYS.membership(LUKE, TRIP),
      ...entity("member", { name: "Luke", status: "active" }),
    },
    // Departed, and deliberately WITHOUT GSI1 keys: the item survives so their
    // name still resolves on events they created, and the sparse index drops
    // the calendar out of their list (§8.4).
    {
      PK: calendarPk(TRIP), SK: SK.member(PRIYA),
      ...entity("member", { name: "Priya", status: "left" }),
    },

    {
      PK: calendarPk(TRIP), SK: SK.event(FLIGHT),
      ...GSI1_KEYS.eventAtTime(TRIP, FLIGHT_AT, FLIGHT),
      ...entity("event", { title: "Flight out", startUtc: FLIGHT_AT }),
    },
    {
      PK: calendarPk(TRIP), SK: SK.event(DINNER),
      ...GSI1_KEYS.eventAtTime(TRIP, DINNER_AT, DINNER),
      // `notes` is deliberately NOT in GSI1's non_key_attributes, so it is the
      // control for the projection test: present on a base-table read, absent
      // from every index read.
      ...entity("event", { title: "Dinner", startUtc: DINNER_AT, notes: "book a table" }),
    },
    // A weekly series. One item, one start time, sorted under its own prefix
    // rather than in the date window, because a series that began in March is
    // invisible to a query for next week (§5.5).
    {
      PK: calendarPk(TRIP), SK: SK.event(STANDUP),
      ...GSI1_KEYS.eventSeries(TRIP, STANDUP),
      ...entity("event", { title: "Check in", rrule: "FREQ=WEEKLY", startUtc: "2026-03-01T09:00:00.000Z" }),
    },

    {
      PK: calendarPk(TRIP), SK: SK.rsvp(DINNER, SERIES_DEFAULT, JAMES),
      ...GSI1_KEYS.rsvp(JAMES, DINNER_AT, TRIP),
      ...entity("rsvp", { status: "going" }),
    },
    {
      PK: calendarPk(TRIP), SK: SK.rsvp(DINNER, SERIES_DEFAULT, LUKE),
      ...GSI1_KEYS.rsvp(LUKE, DINNER_AT, TRIP),
      ...entity("rsvp", { status: "maybe" }),
    },
    {
      PK: calendarPk(TRIP), SK: SK.rsvp(FLIGHT, SERIES_DEFAULT, JAMES),
      ...GSI1_KEYS.rsvp(JAMES, FLIGHT_AT, TRIP),
      ...entity("rsvp", { status: "going" }),
    },

    { PK: calendarPk(TRIP), SK: SK.suggestion(DINNER, SUGGESTION), ...entity("suggestion", { status: "pending" }) },
    { PK: calendarPk(TRIP), SK: SK.availability(JAMES), ...entity("availability") },
    { PK: calendarPk(TRIP), SK: SK.joinRequest(PRIYA), ...entity("joinrequest") },

    { PK: calendarPk(TRIP), SK: SK.change(1), ...entity("change") },
    { PK: calendarPk(TRIP), SK: SK.change(2), ...entity("change") },
    { PK: calendarPk(TRIP), SK: SK.change(3), ...entity("change") },

    // --- a second calendar, so "my calendars" has something to sort -------
    { PK: calendarPk(HOME), SK: SK.meta(), ...entity("calendar", { name: "Home" }) },
    {
      PK: calendarPk(HOME), SK: SK.member(JAMES),
      ...GSI1_KEYS.membership(JAMES, HOME),
      ...entity("member", { name: "James", status: "active" }),
    },
    {
      PK: calendarPk(HOME), SK: SK.event(FLIGHT),
      ...GSI1_KEYS.eventAtTime(HOME, CHRISTMAS_AT, FLIGHT),
      ...entity("event", { title: "Christmas", startUtc: CHRISTMAS_AT }),
    },

    // --- things hanging off the user -------------------------------------
    { PK: userPk(JAMES), SK: SK.profile(), ...entity("user", { name: "James" }) },
    { PK: userPk(JAMES), SK: SK.notification("2026-09-01T09:00:00.000Z", "01N1"), ...entity("notification") },
    { PK: userPk(JAMES), SK: SK.notification("2026-09-04T09:00:00.000Z", "01N2"), ...entity("notification") },
    { PK: userPk(JAMES), SK: SK.notification("2026-09-05T09:00:00.000Z", "01N3"), ...entity("notification") },
    // An outstanding request of James's own, on the index (pattern 16 by user).
    {
      PK: userPk(JAMES), SK: SK.pendingInviteForUser(HOME),
      ...GSI1_KEYS.joinRequest(JAMES, HOME),
      ...entity("joinrequest"),
    },

    // --- invites ----------------------------------------------------------
    { PK: invitePk(INVITE_HASH), SK: SK.meta(), ...entity("invite", { status: "active" }) },
    { PK: pendingInvitePk(EMAIL_HASH), SK: SK.pendingInviteForEmail(TRIP), ...entity("pendinginvite") },
    { PK: pendingInvitePk(EMAIL_HASH), SK: SK.pendingInviteForEmail(HOME), ...entity("pendinginvite") },
    { PK: identityPk(SUB), SK: SK.meta(), ...entity("identity", { name: JAMES }) },
  ];
}

export async function seed(db) {
  const all = items();
  for (let i = 0; i < all.length; i += 25) {
    await db.send(
      new BatchWriteCommand({
        RequestItems: { [TABLE]: all.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) },
      }),
    );
  }
  return all.length;
}

export { padSeq };
