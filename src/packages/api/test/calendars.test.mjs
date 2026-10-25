import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { SK, calendarPk, userPk } from "@calder/core";
import { TABLE, freshTable } from "./table.mjs";

/**
 * The calendar slice, against a real engine.
 *
 * Against the BUNDLE rather than the sources, like every other test here,
 * because the bundle is what Lambda runs and bundling has its own ways to fail.
 *
 * What is worth testing is not that a put puts. It is the four things that are
 * invisible in review and expensive in production: that a retried create
 * converges rather than duplicating or clobbering, that a stale edit loses,
 * that leaving a calendar removes it from a list without deleting the row that
 * resolves the person's name, and that the change log cannot feed on itself.
 */

const {
  accessTo,
  createCalendar,
  editCalendar,
  listCalendars,
  changesSince,
  isLoggable,
  logOne,
} = await import("../dist/index.mjs");

const JAMES = "01USERJAMES00000000000000";
const LUKE = "01USERLUKE000000000000000";
const TRIP = "01CALTRIP0000000000000000";
const NOW = "2026-09-05T12:00:00.000Z";

const NEW = {
  name: "Lisbon",
  mode: "bounded",
  defaultTz: "Europe/London",
  collectAvailability: true,
  allowMemberEvents: true,
  travelMode: "plane",
  isPrivate: true,
};

let db;
let close;

beforeEach(async () => {
  ({ db, close } = await freshTable());
});

// afterEach, not after. A fresh engine per test means a fresh SERVER per test,
// and closing only the last one leaks every earlier one — which does not fail
// anything, it just stops the runner ever exiting. That reads as a hung test
// suite rather than as a leak, which is how it cost half an hour once already.
afterEach(() => {
  db?.destroy?.();
  close?.();
});

test("creating a calendar makes the creator its owner", async () => {
  const { created } = await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  assert.equal(created, true);

  const access = await accessTo(TABLE, TRIP, JAMES, db);
  assert.equal(access.ok, true);
  assert.equal(access.calendar.name, "Lisbon");
  assert.equal(access.membership.role, "owner");
  // §8.3: a calendar with no owner is unadministrable, so the membership is
  // not optional and not deferred.
  assert.equal(access.membership.status, "active");
});

test("creating it again is success, not a duplicate", async () => {
  // The client retries a queued mutation forever (§5.3), so this is the
  // ORDINARY path rather than an edge case.
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  const again = await createCalendar(
    TABLE, TRIP, JAMES, "James", { ...NEW, name: "Renamed by a retry" }, NOW, db,
  );

  assert.equal(again.created, false);
  const access = await accessTo(TABLE, TRIP, JAMES, db);
  // The retry must not overwrite. A queued create arriving after the calendar
  // was renamed would otherwise undo the rename.
  assert.equal(access.calendar.name, "Lisbon");
});

test("a retry finishes a create that stopped halfway", async () => {
  // The exact failure the two-step design admits: meta written, membership not.
  // Nothing recovers this except the client retrying, so it had better work.
  await db.send(await putMeta(db));
  const { created } = await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);

  assert.equal(created, false, "the meta was already there");
  const access = await accessTo(TABLE, TRIP, JAMES, db);
  assert.equal(access.ok, true, "the retry supplied the missing membership");
  assert.equal(access.membership.role, "owner");
});

test("a retry does not restore somebody who left", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
  await db.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: calendarPk(TRIP), SK: SK.member(JAMES) },
      UpdateExpression: "SET #s = :left REMOVE GSI1PK, GSI1SK",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":left": "left" },
    }),
  );

  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);

  const access = await accessTo(TABLE, TRIP, JAMES, db);
  assert.equal(access.ok, false, "a stale queued create must not readmit them");
});

test("a non-member cannot see the calendar, and cannot tell it exists", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);

  const stranger = await accessTo(TABLE, TRIP, LUKE, db);
  const nothing = await accessTo(TABLE, "01CALNOSUCH00000000000000", LUKE, db);

  assert.equal(stranger.ok, false);
  assert.equal(nothing.ok, false);
  // The same status for both, so the response cannot be used to enumerate ids.
  assert.equal(stranger.status, nothing.status);
});

test("my calendars come from the index, and leaving removes them from it", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  // Ids, not membership rows: GSI1's projection does not carry role or
  // lastSeenSeq, and a version of this that returned them would return
  // undefined for each in production while passing any test that used a mock.
  assert.deepEqual(await listCalendars(TABLE, JAMES, db), [TRIP]);

  const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
  await db.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: calendarPk(TRIP), SK: SK.member(JAMES) },
      UpdateExpression: "SET #s = :left REMOVE GSI1PK, GSI1SK",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":left": "left" },
    }),
  );

  assert.deepEqual(await listCalendars(TABLE, JAMES, db), [], "sparse index drops it");

  // But the item survives, which is the whole point: their name still resolves
  // on events they created (§8.4).
  const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
  const still = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: calendarPk(TRIP), SK: SK.member(JAMES) } }),
  );
  assert.equal(still.Item.displayName, "James");
});

test("an edit at the current version wins and bumps it", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  const result = await editCalendar(
    TABLE, TRIP, JAMES, { name: "Lisbon, October", version: 1 }, NOW, db,
  );

  assert.equal(result.ok, true);
  assert.equal(result.calendar.name, "Lisbon, October");
  assert.equal(result.calendar.version, 2);
  assert.equal(result.calendar.lastUpdatedBy, JAMES);
});

test("an edit at a stale version is refused rather than winning silently", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  await editCalendar(TABLE, TRIP, JAMES, { name: "First", version: 1 }, NOW, db);

  // Somebody who read version 1, went to make tea, and came back.
  const stale = await editCalendar(TABLE, TRIP, JAMES, { name: "Second", version: 1 }, NOW, db);

  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  const access = await accessTo(TABLE, TRIP, JAMES, db);
  assert.equal(access.calendar.name, "First", "the first edit survives");
});

test("a member who is not an owner cannot change settings", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
  await db.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: calendarPk(TRIP), SK: SK.member(LUKE),
        GSI1PK: userPk(LUKE), GSI1SK: calendarPk(TRIP),
        entityType: "membership", calendarId: TRIP, userId: LUKE,
        role: "member", status: "active", displayName: "Luke",
        joinedAt: NOW, wasRemoved: false, lastSeenSeq: 0, notifyMuted: false,
      },
    }),
  );

  const refused = await editCalendar(TABLE, TRIP, LUKE, { name: "Mine now", version: 1 }, NOW, db);
  // 403 rather than 404: Luke can see the calendar, so there is nothing to hide
  // by pretending it is absent, and the useful answer is why.
  assert.equal(refused.status, 403);
});

// --- the change log --------------------------------------------------------

test("the consumer ignores its own writes", () => {
  // The loop guard. Without both of these the consumer logs the change item it
  // just wrote, and the counter it just bumped, forever.
  assert.equal(isLoggable(calendarPk(TRIP), SK.meta()), true);
  assert.equal(isLoggable(calendarPk(TRIP), SK.change(1)), false);
  assert.equal(isLoggable(calendarPk(TRIP), SK.seqCounter()), false);
  // Users and identities have no calendar feed to belong to.
  assert.equal(isLoggable(userPk(JAMES), SK.profile()), false);
});

test("sequence numbers are gap-free and ordered", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);

  const seqs = [];
  for (const name of ["one", "two", "three"]) {
    const change = await logOne(TABLE, recordFor(TRIP, SK.meta(), { name }), NOW, db);
    seqs.push(change.seq);
  }

  assert.deepEqual(seqs, [1, 2, 3]);
});

test("changes come back after the watermark, in order, and stop", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  for (const name of ["one", "two", "three"]) {
    await logOne(TABLE, recordFor(TRIP, SK.meta(), { name }), NOW, db);
  }

  const all = await changesSince(TABLE, TRIP, JAMES, 0, 500, db);
  assert.equal(all.ok, true);
  assert.deepEqual(all.body.changes.map((c) => c.seq), [1, 2, 3]);
  assert.equal(all.body.nextSeq, 3);

  // since is EXCLUSIVE: a client that has seen 2 is given 3 and nothing else.
  const rest = await changesSince(TABLE, TRIP, JAMES, 2, 500, db);
  assert.deepEqual(rest.body.changes.map((c) => c.seq), [3]);

  const done = await changesSince(TABLE, TRIP, JAMES, 3, 500, db);
  assert.deepEqual(done.body.changes, []);
  assert.equal(done.body.hasMore, false);
});

test("sequence numbers sort as strings, so ten does not come before nine", async () => {
  // The bug this exists for: without padding, CHG#10 sorts before CHG#9 and a
  // client silently stops receiving changes after the ninth one, forever.
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  for (let i = 0; i < 12; i += 1) {
    await logOne(TABLE, recordFor(TRIP, SK.meta(), { i }), NOW, db);
  }

  const from9 = await changesSince(TABLE, TRIP, JAMES, 9, 500, db);
  assert.deepEqual(from9.body.changes.map((c) => c.seq), [10, 11, 12]);
});

test("a watermark older than the log asks for a snapshot rather than skipping", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  // A log whose oldest surviving entry is 50: everything before it has expired.
  await seedChange(db, TRIP, 50);

  const gone = await changesSince(TABLE, TRIP, JAMES, 10, 500, db);
  assert.equal(gone.ok, false);
  assert.equal(gone.status, 410);
  assert.equal(gone.body.asOfSeq, 50);
});

test("a calendar with no changes yet is up to date, not expired", async () => {
  // The mirror of the test above. A first sync also finds nothing, and
  // answering 410 to it would send every new client to a snapshot it does not
  // need — which is what the naive "is the result empty" version of the gap
  // check does.
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);

  const first = await changesSince(TABLE, TRIP, JAMES, 0, 500, db);
  assert.equal(first.ok, true);
  assert.deepEqual(first.body.changes, []);
});

test("a client that is exactly current is not sent to a snapshot", async () => {
  // The off-by-one that would make every up-to-date client resync forever:
  // after seeing seq 3, the next change is 4, and 4 > 3 must NOT read as a gap.
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  for (const name of ["one", "two", "three"]) {
    await logOne(TABLE, recordFor(TRIP, SK.meta(), { name }), NOW, db);
  }
  await logOne(TABLE, recordFor(TRIP, SK.meta(), { name: "four" }), NOW, db);

  const next = await changesSince(TABLE, TRIP, JAMES, 3, 500, db);
  assert.equal(next.ok, true);
  assert.deepEqual(next.body.changes.map((c) => c.seq), [4]);
});

test("changes are refused to somebody who is not a member", async () => {
  await createCalendar(TABLE, TRIP, JAMES, "James", NEW, NOW, db);
  const refused = await changesSince(TABLE, TRIP, LUKE, 0, 500, db);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 404);
});

// --- helpers ---------------------------------------------------------------

/** A stream record, in the AttributeValue shape the consumer really receives. */
function recordFor(calendarId, sk, extra = {}) {
  return {
    eventID: `ev-${Math.random()}`,
    eventName: "MODIFY",
    dynamodb: {
      Keys: { PK: { S: calendarPk(calendarId) }, SK: { S: sk } },
      NewImage: {
        PK: { S: calendarPk(calendarId) },
        SK: { S: sk },
        entityType: { S: "calendar" },
        lastUpdatedBy: { S: JAMES },
        ...Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [k, typeof v === "number" ? { N: String(v) } : { S: String(v) }]),
        ),
      },
    },
  };
}

async function putMeta(client) {
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
  return new PutCommand({
    TableName: TABLE,
    Item: {
      PK: calendarPk(TRIP), SK: SK.meta(), entityType: "calendar",
      calendarId: TRIP, name: "Lisbon", mode: "bounded",
      defaultTz: "Europe/London", collectAvailability: true, travelMode: "plane",
      requireApproval: true, allowMemberInvites: false, allowMemberEvents: true,
      icsToken: "", status: "active", createdBy: JAMES, createdAt: NOW,
      version: 1, updatedAt: NOW, lastUpdatedBy: JAMES,
    },
  });
}

async function seedChange(client, calendarId, seq) {
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
  await client.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: calendarPk(calendarId), SK: SK.change(seq), entityType: "change",
        calendarId, seq, op: "put", targetType: "calendar", targetId: SK.meta(),
        actorId: JAMES, serverTs: NOW,
      },
    }),
  );
}
