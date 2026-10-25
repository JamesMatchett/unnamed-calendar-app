import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { SK, calendarPk } from "@calder/core";
import { TABLE, freshTable } from "./table.mjs";

/**
 * Events, RSVPs, leaving, and deleting a calendar, against a real engine and
 * the built bundle, like the calendar tests.
 *
 * What is worth testing is what review cannot see: that a retried create does
 * not clobber an edit, that a stale edit loses and a fresh one wins, that a
 * member cannot edit somebody else's event while an owner can, that deleting
 * an event takes its answers with it, that the token decides whose answer an
 * RSVP is, that the last owner cannot leave, and that every one of these
 * writes shows up in the change feed in the shape the client applies.
 */

const {
  accessTo,
  createCalendar,
  deleteCalendar,
  createEvent,
  editEvent,
  deleteEvent,
  putRsvp,
  clearRsvp,
  setTicket,
  removeMember,
  changesSince,
  logOne,
  route,
} = await import("../dist/index.mjs");

const JAMES = "01USERJAMES00000000000000";
const LUKE = "01USERLUKE000000000000000";
const PRIYA = "01USERPRIYA00000000000000";
const TRIP = "01CALTRIP0000000000000000";
const DINNER = "01EVDINNER000000000000000";
const NOW = "2026-09-05T12:00:00.000Z";
const LATER = "2026-09-05T12:05:00.000Z";

const NEW_CAL = {
  name: "Lisbon",
  mode: "bounded",
  defaultTz: "Europe/Lisbon",
  collectAvailability: true,
  allowMemberEvents: true,
  travelMode: "plane",
  isPrivate: false,
};

/** The app's flattened row, exactly as the queue sends it. */
const NEW_EVENT = {
  title: "Dinner",
  description: null,
  startUtc: "2026-10-02T18:30:00.000Z",
  endUtc: null,
  tz: "Europe/Lisbon",
  localWall: "2026-10-02T19:30",
  precision: "datetime",
  locationName: "Cervejaria Ramiro",
  locationAddress: null,
  ticketsRequired: false,
  ticketUrl: null,
  imageKey: null,
};

let db;
let close;

beforeEach(async () => {
  ({ db, close } = await freshTable());
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW_CAL, NOW, db);
});

afterEach(() => {
  db?.destroy?.();
  close?.();
});

/** Luke joins as a plain member, by writing the item the join flow will write. */
async function addMember(userId, name, role = "member") {
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
  await db.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: calendarPk(TRIP),
        SK: SK.member(userId),
        GSI1PK: `USER#${userId}`,
        GSI1SK: calendarPk(TRIP),
        entityType: "membership",
        calendarId: TRIP,
        userId,
        role,
        status: "active",
        displayName: name,
        joinedAt: NOW,
        wasRemoved: false,
        lastSeenSeq: 0,
        notifyMuted: false,
      },
    }),
  );
}

// --- events ----------------------------------------------------------------

test("creating an event folds the flat body into the nested item", async () => {
  const result = await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);
  assert.equal(result.ok, true);
  assert.equal(result.created, true);

  const { event } = result;
  assert.equal(event.entityType, "event");
  assert.equal(event.title, "Dinner");
  assert.deepEqual(event.time, {
    startUtc: NEW_EVENT.startUtc,
    tz: "Europe/Lisbon",
    localWall: "2026-10-02T19:30",
    precision: "datetime",
  });
  assert.deepEqual(event.location, { name: "Cervejaria Ramiro" });
  // Nulls from a SQLite row must not become null attributes: absent means
  // absent, so `attribute_exists` keeps meaning something.
  assert.equal("description" in event, false);
  assert.equal("ticketUrl" in event, false);
  assert.equal(event.version, 1);
  assert.equal(event.status, "active");
  // Pattern 4: sorted by start time in the date window.
  assert.equal(event.GSI1SK, `T#${NEW_EVENT.startUtc}#${DINNER}`);
});

test("creating it again is success and does not overwrite", async () => {
  await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);
  await editEvent(TABLE, TRIP, DINNER, JAMES, { title: "Late dinner", version: 1 }, LATER, db);

  // The queue retries a create forever (§5.3); this one arrives after an edit.
  const again = await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, LATER, db);
  assert.equal(again.ok, true);
  assert.equal(again.created, false);
  // Returns what IS there, so the client reconciles to the truth.
  assert.equal(again.event.title, "Late dinner");
  assert.equal(again.event.version, 2);
});

test("a member may add events unless the calendar is curated", async () => {
  await addMember(LUKE, "Luke");
  const allowed = await createEvent(TABLE, TRIP, DINNER, LUKE, NEW_EVENT, NOW, db);
  assert.equal(allowed.ok, true);

  const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
  await db.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: calendarPk(TRIP), SK: SK.meta() },
      UpdateExpression: "SET allowMemberEvents = :no",
      ExpressionAttributeValues: { ":no": false },
    }),
  );
  const refused = await createEvent(TABLE, TRIP, "01EVOTHER0000000000000000", LUKE, NEW_EVENT, NOW, db);
  assert.equal(refused.ok, false);
  // 403, not 404: they can see the calendar, so there is nothing to hide.
  assert.equal(refused.status, 403);
  // Owners always can.
  const owner = await createEvent(TABLE, TRIP, "01EVOTHER0000000000000000", JAMES, NEW_EVENT, NOW, db);
  assert.equal(owner.ok, true);
});

test("a non-member cannot see the calendar, so the event is a 404", async () => {
  const result = await createEvent(TABLE, TRIP, DINNER, PRIYA, NEW_EVENT, NOW, db);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("a bad body is a 400 with a reason", async () => {
  const result = await createEvent(TABLE, TRIP, DINNER, JAMES, { ...NEW_EVENT, startUtc: "tomorrow" }, NOW, db);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.detail, /startUtc/);
});

test("a fresh edit wins and a stale one loses", async () => {
  await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);

  const fresh = await editEvent(
    TABLE, TRIP, DINNER, JAMES,
    { title: "Late dinner", startUtc: "2026-10-02T20:00:00.000Z", localWall: "2026-10-02T21:00", version: 1 },
    LATER, db,
  );
  assert.equal(fresh.ok, true);
  assert.equal(fresh.event.version, 2);
  assert.equal(fresh.event.title, "Late dinner");
  // The time is one attribute: the parts not sent are kept, not dropped.
  assert.equal(fresh.event.time.tz, "Europe/Lisbon");
  assert.equal(fresh.event.time.startUtc, "2026-10-02T20:00:00.000Z");
  // And the date-window key follows the start time (§5.5, pattern 4).
  assert.equal(fresh.event.GSI1SK, `T#2026-10-02T20:00:00.000Z#${DINNER}`);
  assert.equal(fresh.event.lastUpdatedAt, LATER);

  // Somebody still holding version 1.
  const stale = await editEvent(TABLE, TRIP, DINNER, JAMES, { title: "Early dinner", version: 1 }, LATER, db);
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  const access = await accessTo(TABLE, TRIP, JAMES, db);
  assert.equal(access.ok, true);
  const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
  const got = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: calendarPk(TRIP), SK: SK.event(DINNER) } }),
  );
  assert.equal(got.Item.title, "Late dinner", "the stale edit must not win");
});

test("clearing a field removes it rather than writing null", async () => {
  await createEvent(TABLE, TRIP, DINNER, JAMES, { ...NEW_EVENT, description: "Book a table" }, NOW, db);
  const edited = await editEvent(
    TABLE, TRIP, DINNER, JAMES,
    { description: null, locationName: null, version: 1 },
    LATER, db,
  );
  assert.equal(edited.ok, true);
  assert.equal("description" in edited.event, false);
  assert.equal("location" in edited.event, false);
});

test("cancelling is an edit, and only the author or an owner may make it", async () => {
  await addMember(LUKE, "Luke");
  await addMember(PRIYA, "Priya");
  await createEvent(TABLE, TRIP, DINNER, LUKE, NEW_EVENT, NOW, db);

  const other = await editEvent(TABLE, TRIP, DINNER, PRIYA, { status: "cancelled", version: 1 }, LATER, db);
  assert.equal(other.ok, false);
  assert.equal(other.status, 403);

  const author = await editEvent(TABLE, TRIP, DINNER, LUKE, { status: "cancelled", version: 1 }, LATER, db);
  assert.equal(author.ok, true);
  assert.equal(author.event.status, "cancelled");
  assert.equal(author.event.cancelledBy, LUKE);
  assert.equal(author.event.cancelledAt, LATER);

  // The owner may reinstate somebody else's event (§8.1).
  const owner = await editEvent(TABLE, TRIP, DINNER, JAMES, { status: "active", version: 2 }, LATER, db);
  assert.equal(owner.ok, true);
  assert.equal(owner.event.status, "active");
  assert.equal("cancelledBy" in owner.event, false);
});

test("deleting an event takes every answer to it, and nothing else", async () => {
  await addMember(LUKE, "Luke");
  await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);
  await createEvent(TABLE, TRIP, "01EVOTHER0000000000000000", JAMES, NEW_EVENT, NOW, db);
  await putRsvp(TABLE, TRIP, DINNER, JAMES, { occurrence: "-", status: "going" }, NOW, db);
  await putRsvp(TABLE, TRIP, DINNER, LUKE, { occurrence: "-", status: "maybe" }, NOW, db);
  await putRsvp(TABLE, TRIP, "01EVOTHER0000000000000000", LUKE, { occurrence: "-", status: "going" }, NOW, db);

  // A plain member cannot delete somebody else's event.
  const refused = await deleteEvent(TABLE, TRIP, DINNER, LUKE, db);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 403);

  const result = await deleteEvent(TABLE, TRIP, DINNER, JAMES, db);
  assert.equal(result.ok, true);

  const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
  const left = await db.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": calendarPk(TRIP) },
    }),
  );
  const keys = left.Items.map((i) => i.SK).sort();
  assert.deepEqual(keys, [
    SK.event("01EVOTHER0000000000000000"),
    SK.member(JAMES),
    SK.member(LUKE),
    SK.meta(),
    SK.rsvp("01EVOTHER0000000000000000", "-", LUKE),
  ]);

  // Already gone is success: the queue retries until it is.
  assert.equal((await deleteEvent(TABLE, TRIP, DINNER, JAMES, db)).ok, true);
});

// --- rsvps -----------------------------------------------------------------

test("an answer is the caller's own, whatever the body says", async () => {
  await addMember(LUKE, "Luke");
  await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);

  const result = await putRsvp(
    TABLE, TRIP, DINNER, LUKE,
    // A body trying to answer for James. There is no field for it, and if
    // there were it would be ignored: the key is the token's user.
    { occurrence: "-", status: "going", userId: JAMES },
    NOW, db,
  );
  assert.equal(result.ok, true);
  assert.equal(result.rsvp.userId, LUKE);
  assert.equal(result.rsvp.SK, SK.rsvp(DINNER, "-", LUKE));
  // Pattern 13: my upcoming events across calendars, by start time.
  assert.equal(result.rsvp.GSI1PK, `USER#${LUKE}`);
  assert.equal(result.rsvp.GSI1SK, `RSVP#${NEW_EVENT.startUtc}#${TRIP}`);
});

test("answering again replaces the answer and keeps the ticket", async () => {
  await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);
  await putRsvp(TABLE, TRIP, DINNER, JAMES, { occurrence: "-", status: "maybe" }, NOW, db);
  const ticket = await setTicket(TABLE, TRIP, DINNER, JAMES, { occurrence: "-", ticketStatus: "have" }, NOW, db);
  assert.equal(ticket.ok, true);
  // An existing answer keeps its status: a maybe with a ticket is a real thing.
  assert.equal(ticket.rsvp.status, "maybe");
  assert.equal(ticket.rsvp.ticketStatus, "have");

  const changed = await putRsvp(TABLE, TRIP, DINNER, JAMES, { occurrence: "-", status: "going" }, LATER, db);
  assert.equal(changed.rsvp.status, "going");
  assert.equal(changed.rsvp.ticketStatus, "have", "changing the answer is not a statement about tickets");
  assert.equal(changed.rsvp.respondedAt, LATER);
});

test("a ticket with no answer yet means going", async () => {
  await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);
  const result = await setTicket(TABLE, TRIP, DINNER, JAMES, { occurrence: "-", ticketStatus: "looking" }, NOW, db);
  assert.equal(result.ok, true);
  assert.equal(result.rsvp.status, "going");
  assert.equal(result.rsvp.ticketStatus, "looking");
});

test("withdrawing an answer removes it, and twice is fine", async () => {
  await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);
  await putRsvp(TABLE, TRIP, DINNER, JAMES, { occurrence: "-", status: "going" }, NOW, db);
  assert.equal((await clearRsvp(TABLE, TRIP, DINNER, JAMES, { occurrence: "-" }, db)).ok, true);
  assert.equal((await clearRsvp(TABLE, TRIP, DINNER, JAMES, { occurrence: "-" }, db)).ok, true);

  const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
  const got = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: calendarPk(TRIP), SK: SK.rsvp(DINNER, "-", JAMES) } }),
  );
  assert.equal(got.Item, undefined);
});

test("an answer to an event that does not exist is a 404, and a bad status a 400", async () => {
  const missing = await putRsvp(TABLE, TRIP, DINNER, JAMES, { occurrence: "-", status: "going" }, NOW, db);
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);

  await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);
  const bad = await putRsvp(TABLE, TRIP, DINNER, JAMES, { occurrence: "-", status: "yes" }, NOW, db);
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
});

// --- members ---------------------------------------------------------------

test("leaving soft-deletes the membership and drops it from the list", async () => {
  await addMember(LUKE, "Luke");
  const result = await removeMember(TABLE, TRIP, LUKE, LUKE, "left", NOW, db);
  assert.equal(result.ok, true);
  assert.equal(result.membership.status, "left");
  assert.equal(result.membership.leftAt, NOW);
  assert.equal(result.membership.wasRemoved, false, "walking out is not being thrown out");
  assert.equal("GSI1PK" in result.membership, false);
  // The row survives, so Luke's name still resolves on his events (§8.4).
  assert.equal(result.membership.displayName, "Luke");

  const access = await accessTo(TABLE, TRIP, LUKE, db);
  assert.equal(access.ok, false);
});

test("the last owner cannot leave", async () => {
  await addMember(LUKE, "Luke");
  const result = await removeMember(TABLE, TRIP, JAMES, JAMES, "left", NOW, db);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);

  // With a second owner it is fine.
  await addMember(PRIYA, "Priya", "owner");
  assert.equal((await removeMember(TABLE, TRIP, JAMES, JAMES, "left", NOW, db)).ok, true);
});

test("removal is an owner's act, marks wasRemoved, and spares other owners", async () => {
  await addMember(LUKE, "Luke");
  await addMember(PRIYA, "Priya", "owner");

  const byMember = await removeMember(TABLE, TRIP, LUKE, PRIYA, "removed", NOW, db);
  assert.equal(byMember.ok, false);
  assert.equal(byMember.status, 403);

  const anOwner = await removeMember(TABLE, TRIP, JAMES, PRIYA, "removed", NOW, db);
  assert.equal(anOwner.ok, false);
  assert.equal(anOwner.status, 403, "owners are demoted, not removed");

  const result = await removeMember(TABLE, TRIP, JAMES, LUKE, "removed", NOW, db);
  assert.equal(result.ok, true);
  assert.equal(result.membership.status, "removed");
  assert.equal(result.membership.wasRemoved, true);
  assert.equal(result.membership.removedAt, NOW);

  // A member's departure labelled as a removal is refused rather than recorded.
  const mislabelled = await removeMember(TABLE, TRIP, PRIYA, PRIYA, "removed", NOW, db);
  assert.equal(mislabelled.ok, false);
  assert.equal(mislabelled.status, 400);
});

// --- deleting a calendar ---------------------------------------------------

test("deleting a calendar is a status change that makes it unreachable", async () => {
  await addMember(LUKE, "Luke");
  const byMember = await deleteCalendar(TABLE, TRIP, LUKE, NOW, db);
  assert.equal(byMember.ok, false);
  assert.equal(byMember.status, 403);

  const result = await deleteCalendar(TABLE, TRIP, JAMES, NOW, db);
  assert.equal(result.ok, true);
  assert.equal(result.calendar.status, "deleted");
  assert.equal(result.calendar.deletedAt, NOW);
  assert.equal(typeof result.calendar.expiresAt, "number", "the TTL does the eventual removal");
  assert.equal(result.calendar.version, 2);

  assert.equal((await accessTo(TABLE, TRIP, JAMES, db)).ok, false);
  // Deleting again is success, because the queue retries until it is.
  const again = await deleteCalendar(TABLE, TRIP, JAMES, LATER, db);
  assert.equal(again.ok, true);
  assert.equal(again.calendar.deletedAt, NOW, "and does not re-stamp it");
});

// --- the change feed -------------------------------------------------------

/** Replay a write through the consumer as the stream would deliver it. */
async function logged(eventName, sk, image) {
  const { marshall } = await import("@aws-sdk/util-dynamodb");
  const Keys = marshall({ PK: calendarPk(TRIP), SK: sk });
  return logOne(
    TABLE,
    {
      eventID: `${eventName}-${sk}`,
      eventName,
      dynamodb: eventName === "REMOVE" ? { Keys, OldImage: marshall(image) } : { Keys, NewImage: marshall(image) },
    },
    NOW,
    db,
  );
}

test("every write arrives through the feed in a shape the client can apply", async () => {
  await addMember(LUKE, "Luke");
  const created = await createEvent(TABLE, TRIP, DINNER, JAMES, NEW_EVENT, NOW, db);
  const answered = await putRsvp(TABLE, TRIP, DINNER, LUKE, { occurrence: "-", status: "going" }, NOW, db);
  await logged("INSERT", SK.event(DINNER), created.event);
  await logged("INSERT", SK.rsvp(DINNER, "-", LUKE), answered.rsvp);
  await deleteEvent(TABLE, TRIP, DINNER, JAMES, db);
  await logged("REMOVE", SK.rsvp(DINNER, "-", LUKE), answered.rsvp);
  await logged("REMOVE", SK.event(DINNER), created.event);

  const feed = await changesSince(TABLE, TRIP, LUKE, 0, 500, db);
  assert.equal(feed.ok, true);
  const summary = feed.body.changes.map((c) => [c.seq, c.op, c.targetType, c.targetId]);
  assert.deepEqual(summary, [
    [1, "put", "event", SK.event(DINNER)],
    [2, "put", "rsvp", SK.rsvp(DINNER, "-", LUKE)],
    [3, "delete", "rsvp", SK.rsvp(DINNER, "-", LUKE)],
    [4, "delete", "event", SK.event(DINNER)],
  ]);
  // A put carries the whole item; a delete carries nothing but the key.
  assert.equal(feed.body.changes[0].item.title, "Dinner");
  assert.equal(feed.body.changes[0].actorId, JAMES);
  assert.equal(feed.body.changes[1].actorId, LUKE);
  assert.equal("item" in feed.body.changes[3], false);
});

// --- the router ------------------------------------------------------------

/** A payload-format-2.0 request for an authorised route. */
function request(routeKey, params, body, claims = { sub: "s", uid: JAMES, name: "James" }) {
  const [method, path] = routeKey.split(" ");
  return {
    version: "2.0",
    routeKey,
    pathParameters: params,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    requestContext: { requestId: "t", http: { method, path }, authorizer: { jwt: { claims } } },
  };
}
const parse = (r) => JSON.parse(r.body);

test("the router reaches every new handler and spells its refusals the same way", async () => {
  process.env.CALDER_TABLE = TABLE;
  const { useClient } = await import("../dist/index.mjs");
  useClient(db);
  try {
    const ids = { calendarId: TRIP, eventId: DINNER };

    const created = await route(request("PUT /v1/calendars/{calendarId}/events/{eventId}", ids, NEW_EVENT));
    assert.equal(created.statusCode, 201);
    assert.equal(parse(created).created, true);

    const repeat = await route(request("PUT /v1/calendars/{calendarId}/events/{eventId}", ids, NEW_EVENT));
    assert.equal(repeat.statusCode, 200);
    assert.equal(parse(repeat).created, false);

    const noVersion = await route(request("PATCH /v1/calendars/{calendarId}/events/{eventId}", ids, { title: "x" }));
    assert.equal(noVersion.statusCode, 400);
    assert.equal(parse(noVersion).error, "bad_request");

    const edited = await route(
      request("PATCH /v1/calendars/{calendarId}/events/{eventId}", ids, { title: "Late dinner", version: 1 }),
    );
    assert.equal(edited.statusCode, 200);
    assert.equal(parse(edited).event.version, 2);

    const stale = await route(
      request("PATCH /v1/calendars/{calendarId}/events/{eventId}", ids, { title: "Early", version: 1 }),
    );
    assert.equal(stale.statusCode, 409);
    assert.equal(parse(stale).error, "conflict");

    const rsvp = await route(
      request("PUT /v1/calendars/{calendarId}/events/{eventId}/rsvp", ids, { occurrence: "-", status: "going" }),
    );
    assert.equal(rsvp.statusCode, 200);
    assert.equal(parse(rsvp).rsvp.userId, JAMES);

    const ticket = await route(
      request("PUT /v1/calendars/{calendarId}/events/{eventId}/rsvp/ticket", ids, { occurrence: "-", ticketStatus: "have" }),
    );
    assert.equal(parse(ticket).rsvp.ticketStatus, "have");

    const cleared = await route(
      request("DELETE /v1/calendars/{calendarId}/events/{eventId}/rsvp", ids, { occurrence: "-" }),
    );
    assert.equal(cleared.statusCode, 200);

    const asStranger = await route(
      request("DELETE /v1/calendars/{calendarId}/events/{eventId}", ids, undefined, { sub: "p", uid: PRIYA }),
    );
    assert.equal(asStranger.statusCode, 404);
    assert.equal(parse(asStranger).error, "not_found");

    const deleted = await route(request("DELETE /v1/calendars/{calendarId}/events/{eventId}", ids));
    assert.equal(deleted.statusCode, 200);

    const lastOwner = await route(
      request("DELETE /v1/calendars/{calendarId}/members/{userId}", { calendarId: TRIP, userId: JAMES }, { status: "left" }),
    );
    assert.equal(lastOwner.statusCode, 409);

    const gone = await route(request("DELETE /v1/calendars/{calendarId}", { calendarId: TRIP }));
    assert.equal(gone.statusCode, 200);
    assert.equal(parse(gone).calendar.status, "deleted");

    const after = await route(request("GET /v1/calendars/{calendarId}", { calendarId: TRIP }));
    assert.equal(after.statusCode, 404);
  } finally {
    useClient(undefined);
    delete process.env.CALDER_TABLE;
  }
});
