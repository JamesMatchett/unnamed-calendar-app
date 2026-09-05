import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import {
  GSI1_SK_PREFIX,
  KEY_PREFIX,
  SERIES_DEFAULT,
  SK,
  SK_PREFIX,
  calendarPk,
  identityPk,
  invitePk,
  padSeq,
  pendingInvitePk,
  userPk,
} from "@calder/core";
import { INDEX, TABLE, freshTable } from "./table.mjs";
import * as W from "./world.mjs";

/**
 * The seventeen access patterns of Architecture.md §4.4, executed.
 *
 * §4.2 calls the base table's key schema a one-way door: PK and SK cannot be
 * changed on a live table, so getting it wrong means a new table and a full
 * migration of everything in it. §12 therefore says to prove the model against
 * this list BEFORE building the core loop. This is that proof, and it earns its
 * keep immediately — pattern 11 as documented returns the entire calendar
 * partition rather than the change log.
 *
 * Every query below is a Query or a GetItem. There is no Scan in this file and
 * there should never be one: a Scan reads the whole table and bills for it, and
 * the single-table design exists precisely so that no access pattern needs one.
 *
 * ONE GAP, stated rather than hidden. Patterns 8 and 12 are specified as
 * TransactWriteItems, and dynalite does not implement that operation at all.
 * What is checked here is that the items those transactions touch share a
 * partition; the atomicity itself is not. Anything that genuinely depends on a
 * transaction has to be proved against real DynamoDB, or designed not to need
 * one — which is what the identity trigger did.
 */

const TF = new URL("../../../terraform/modules/data/main.tf", import.meta.url);
const ARCHITECTURE = new URL("../../../../Architecture.md", import.meta.url);

let db;
let close;

before(async () => {
  const tf = readFileSync(TF, "utf8");
  ({ db, close } = await freshTable(tf));
  await W.seed(db);
});

after(() => {
  // destroy() as well as close(): the SDK holds keep-alive sockets open, and
  // without this the tests pass and the process never exits.
  db?.destroy?.();
  close?.();
});

const query = (params) => db.send(new QueryCommand({ TableName: TABLE, ...params }));
const keys = (result) => result.Items.map((i) => i.SK ?? i.GSI1SK);

// --- 1 -----------------------------------------------------------------------

test("1. log in, load my calendars", async () => {
  const result = await query({
    IndexName: INDEX,
    KeyConditionExpression: "GSI1PK = :u AND begins_with(GSI1SK, :p)",
    ExpressionAttributeValues: { ":u": userPk(W.JAMES), ":p": GSI1_SK_PREFIX.calendarsForUser },
  });
  // GSI1SK, not SK: a secondary index always projects the base table's keys as
  // well as its own, so every one of these items also carries MEMBER#{uid}.
  assert.deepEqual(
    result.Items.map((i) => i.GSI1SK).sort(),
    [calendarPk(W.HOME), calendarPk(W.TRIP)].sort(),
  );
});

test("1b. a departed member's calendar drops out, without deleting the item", async () => {
  // The sparse index is the mechanism: the membership item survives so Priya's
  // name still resolves on events she created (§8.4), but with no GSI1 keys it
  // is not in the index at all.
  const mine = await query({
    IndexName: INDEX,
    KeyConditionExpression: "GSI1PK = :u",
    ExpressionAttributeValues: { ":u": userPk(W.PRIYA) },
  });
  assert.equal(mine.Items.length, 0, "a departed member should have no index entries");

  const still = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: calendarPk(W.TRIP), SK: SK.member(W.PRIYA) } }),
  );
  assert.equal(still.Item.name, "Priya", "the membership item itself must survive");
});

// --- 2 -----------------------------------------------------------------------

test("2. am I a member of this calendar", async () => {
  const mine = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: calendarPk(W.TRIP), SK: SK.member(W.JAMES) } }),
  );
  assert.equal(mine.Item.status, "active");

  const absent = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: calendarPk(W.HOME), SK: SK.member(W.LUKE) } }),
  );
  assert.equal(absent.Item, undefined, "a non-member must be an absent item, not an empty one");
});

// --- 3 -----------------------------------------------------------------------

test("3. open a calendar: one query returns everything", async () => {
  // The claim this whole design is accepting a modelling tax for.
  const result = await query({
    KeyConditionExpression: "PK = :c",
    ExpressionAttributeValues: { ":c": calendarPk(W.TRIP) },
  });

  const kinds = new Set(result.Items.map((i) => i.entityType));
  for (const kind of ["calendar", "member", "event", "rsvp", "suggestion", "availability", "change"]) {
    assert.ok(kinds.has(kind), `pattern 3 should return ${kind} items`);
  }
  assert.equal(result.LastEvaluatedKey, undefined, "should not need a second page at this size");
});

// --- 4 -----------------------------------------------------------------------

test("4. events in a date window", async () => {
  const result = await query({
    IndexName: INDEX,
    KeyConditionExpression: "GSI1PK = :c AND GSI1SK BETWEEN :from AND :to",
    ExpressionAttributeValues: {
      ":c": calendarPk(W.TRIP),
      ":from": GSI1_SK_PREFIX.eventsFrom("2026-10-02T00:00:00.000Z"),
      ":to": GSI1_SK_PREFIX.eventsTo("2026-10-02T23:59:59.999Z"),
    },
  });
  assert.deepEqual(result.Items.map((i) => i.title), ["Flight out", "Dinner"],
    "in start-time order, and only that day");
});

test("4b. a recurring series is NOT in the date window", async () => {
  // A weekly event that began in March has one start time in March, so a naive
  // shared prefix would hide it from every future window. Series sort under
  // their own prefix and are fetched whole instead (§5.5, pattern 17).
  const result = await query({
    IndexName: INDEX,
    KeyConditionExpression: "GSI1PK = :c AND GSI1SK BETWEEN :from AND :to",
    ExpressionAttributeValues: {
      ":c": calendarPk(W.TRIP),
      ":from": GSI1_SK_PREFIX.eventsFrom("2026-01-01T00:00:00.000Z"),
      ":to": GSI1_SK_PREFIX.eventsTo("2027-01-01T00:00:00.000Z"),
    },
  });
  assert.ok(!result.Items.some((i) => i.rrule), "a series must not appear in a T# window");
});

// --- 5, 6 --------------------------------------------------------------------

test("5. setting an RSVP is idempotent by key", async () => {
  const key = SK.rsvp(W.DINNER, SERIES_DEFAULT, W.JAMES);
  assert.equal(key, `RSVP#${W.DINNER}#-#${W.JAMES}`);
  // One person, one event, one occurrence is one item, so two devices writing
  // at once cannot produce two answers and no conflict resolution is needed.
  const result = await query({
    KeyConditionExpression: "PK = :c AND SK = :s",
    ExpressionAttributeValues: { ":c": calendarPk(W.TRIP), ":s": key },
  });
  assert.equal(result.Items.length, 1);
});

test("6. who is going to this occurrence", async () => {
  const result = await query({
    KeyConditionExpression: "PK = :c AND begins_with(SK, :p)",
    ExpressionAttributeValues: {
      ":c": calendarPk(W.TRIP),
      ":p": SK_PREFIX.rsvpForOccurrence(W.DINNER, SERIES_DEFAULT),
    },
  });
  assert.equal(result.Items.length, 2, "James and Luke, and nobody from the flight");
  assert.ok(result.Items.every((i) => i.entityType === "rsvp"));
});

// --- 7, 8 --------------------------------------------------------------------

test("7. suggestions on one event", async () => {
  const result = await query({
    KeyConditionExpression: "PK = :c AND begins_with(SK, :p)",
    ExpressionAttributeValues: {
      ":c": calendarPk(W.TRIP),
      ":p": SK_PREFIX.suggestionsForEvent(W.DINNER),
    },
  });
  assert.equal(result.Items.length, 1);
  assert.equal(result.Items[0].status, "pending");
});

test("8. the event and its suggestion share a partition, so one transaction covers both", async () => {
  // TransactWriteItems has no cross-partition restriction, but sharing a
  // partition is what keeps the approval a single-partition write rather than a
  // distributed one.
  assert.equal(
    SK.event(W.DINNER).split("#")[0] === "EVENT" && SK.suggestion(W.DINNER, W.SUGGESTION).split("#")[0] === "SUGG",
    true,
  );
  const both = await query({
    KeyConditionExpression: "PK = :c AND SK BETWEEN :a AND :b",
    ExpressionAttributeValues: { ":c": calendarPk(W.TRIP), ":a": "EVENT#", ":b": "SUGG#￿" },
  });
  assert.ok(both.Items.length > 0);
});

// --- 9, 10 -------------------------------------------------------------------

test("9 and 10. availability is one item per member, read with the calendar", async () => {
  const result = await query({
    KeyConditionExpression: "PK = :c AND begins_with(SK, :p)",
    ExpressionAttributeValues: { ":c": calendarPk(W.TRIP), ":p": SK_PREFIX.availability },
  });
  assert.deepEqual(keys(result), [SK.availability(W.JAMES)]);
});

// --- 11 ----------------------------------------------------------------------

describe("11. delta sync since sequence N", () => {
  test("as §4.4 documents it, returns the whole partition", async () => {
    // THE DEFECT. `SK > CHG#{N}` is a lexicographic bound with no upper limit,
    // and CHG# sorts before EVENT#, JOINREQ#, MEMBER#, META, RSVP# and SUGG#.
    // Every poll would have returned the entire calendar, billed and
    // transferred, with the client handed items it would try to read as
    // changes. It would have looked perfect in every small test.
    const result = await query({
      KeyConditionExpression: "PK = :c AND SK > :s",
      ExpressionAttributeValues: { ":c": calendarPk(W.TRIP), ":s": SK.change(1) },
    });
    const kinds = new Set(result.Items.map((i) => i.entityType));
    assert.ok(kinds.size > 1, "kept as the record of why the bounded form below exists");
    assert.ok(kinds.has("event"), "the unbounded form leaks events into a change feed");
  });

  test("bounded to the change log, it returns only changes", async () => {
    const result = await query({
      KeyConditionExpression: "PK = :c AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":c": calendarPk(W.TRIP),
        ":from": SK.change(2),
        ":to": `${SK_PREFIX.change}￿`,
      },
    });
    assert.deepEqual(keys(result), [SK.change(2), SK.change(3)]);
    assert.ok(result.Items.every((i) => i.entityType === "change"));
  });

  test("the padding is what makes the bound numeric rather than alphabetical", async () => {
    // Without it, CHG#9 sorts after CHG#10 and a client that had seen change 9
    // would never be told about change 10.
    assert.equal(padSeq(9) < padSeq(10), true);
    assert.equal(String(9) < String(10), false, "the unpadded comparison is the bug");
  });
});

// --- 12 ----------------------------------------------------------------------

test("12. redeem an invite by the token's hash", async () => {
  const result = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: invitePk(W.INVITE_HASH), SK: SK.meta() } }),
  );
  assert.equal(result.Item.status, "active");
  assert.ok(invitePk(W.INVITE_HASH).startsWith(KEY_PREFIX.invite));
});

// --- 13 ----------------------------------------------------------------------

test("13. my upcoming events across every calendar, in time order", async () => {
  const result = await query({
    IndexName: INDEX,
    KeyConditionExpression: "GSI1PK = :u AND begins_with(GSI1SK, :p)",
    ExpressionAttributeValues: { ":u": userPk(W.JAMES), ":p": GSI1_SK_PREFIX.rsvpsForUser },
  });
  assert.deepEqual(
    result.Items.map((i) => i.GSI1SK),
    [`RSVP#${W.FLIGHT_AT}#${W.TRIP}`, `RSVP#${W.DINNER_AT}#${W.TRIP}`],
    "the flight is earlier in the day, so it sorts first",
  );
});

// --- 14 ----------------------------------------------------------------------

test("14. my inbox, newest first and pageable", async () => {
  const page = await query({
    KeyConditionExpression: "PK = :u AND begins_with(SK, :p)",
    ExpressionAttributeValues: { ":u": userPk(W.JAMES), ":p": SK_PREFIX.notification },
    ScanIndexForward: false,
    Limit: 2,
  });
  assert.equal(page.Items.length, 2);
  assert.ok(page.Items[0].SK > page.Items[1].SK, "descending");
  assert.ok(page.LastEvaluatedKey, "a Limit short of the total must give a cursor");
});

// --- 15 ----------------------------------------------------------------------

test("15. invites waiting at first sign-in, found by a hash of the address", async () => {
  const result = await query({
    KeyConditionExpression: "PK = :p",
    ExpressionAttributeValues: { ":p": pendingInvitePk(W.EMAIL_HASH) },
  });
  assert.equal(result.Items.length, 2);
  // The address itself is never a key: the table must not accumulate a
  // plaintext list of people who never joined (§7.1).
  assert.ok(!pendingInvitePk(W.EMAIL_HASH).includes("@"));
});

// --- 16 ----------------------------------------------------------------------

test("16. join requests awaiting my approval, per calendar", async () => {
  const result = await query({
    KeyConditionExpression: "PK = :c AND begins_with(SK, :p)",
    ExpressionAttributeValues: { ":c": calendarPk(W.TRIP), ":p": SK_PREFIX.joinRequest },
  });
  assert.deepEqual(keys(result), [SK.joinRequest(W.PRIYA)]);
});

// --- 17 ----------------------------------------------------------------------

test("17. every recurring series in a calendar", async () => {
  const result = await query({
    IndexName: INDEX,
    KeyConditionExpression: "GSI1PK = :c AND begins_with(GSI1SK, :p)",
    ExpressionAttributeValues: { ":c": calendarPk(W.TRIP), ":p": GSI1_SK_PREFIX.seriesInCalendar },
  });
  assert.equal(result.Items.length, 1);
  assert.equal(result.Items[0].title, "Check in");
});

// --- the index only returns what it projects ---------------------------------

test("a GSI query returns only the attributes the index projects", async () => {
  // The failure this catches: a field added to a list view renders on the
  // screen that reads the base table and is silently missing on the one that
  // reads the index.
  const result = await query({
    IndexName: INDEX,
    KeyConditionExpression: "GSI1PK = :c AND begins_with(GSI1SK, :p)",
    ExpressionAttributeValues: { ":c": calendarPk(W.TRIP), ":p": "T#" },
  });
  const fromIndex = result.Items.find((i) => i.title === "Dinner");
  assert.ok(fromIndex.title, "title is in non_key_attributes");
  assert.equal(fromIndex.notes, undefined, "notes is not, so the index cannot return it");

  // The same item read from the base table has it, which is what makes the
  // absence above a projection question rather than a missing-data one.
  const fromTable = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: calendarPk(W.TRIP), SK: SK.event(W.DINNER) } }),
  );
  assert.equal(fromTable.Item.notes, "book a table");

  // Base-table keys are always projected, whatever the projection says.
  assert.ok(fromIndex.PK && fromIndex.SK, "PK and SK come along regardless");
});

// --- the document and this file agree ----------------------------------------

test("every pattern in §4.4 is exercised here", () => {
  // The table in Architecture.md is the contract. If a pattern is added there
  // and not here, the schema stops being proven and nothing else says so.
  const doc = readFileSync(ARCHITECTURE, "utf8");
  const section = doc.slice(doc.indexOf("### 4.4"), doc.indexOf("### 4.5"));
  const numbered = [...section.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
  assert.ok(numbered.length >= 17, `only found ${numbered.length} patterns in §4.4`);

  // The leading token of each test or describe title, up to the first full
  // stop, naming which pattern it covers: "4b.", "9 and 10.", "11.".
  const self = readFileSync(new URL(import.meta.url), "utf8");
  const covered = new Set();
  for (const [, label] of self.matchAll(/^(?:test|describe)\("([0-9a-z, ]+?)\.\s/gm)) {
    for (const [n] of label.matchAll(/\d+/g)) covered.add(Number(n));
  }

  const missing = numbered.filter((n) => !covered.has(n));
  assert.deepEqual(missing, [], `§4.4 patterns with no test: ${missing.join(", ")}`);
});
