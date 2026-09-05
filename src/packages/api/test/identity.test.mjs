import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { identityPk, userPk, SK } from "@calder/core";

import { TABLE, freshTable } from "./table.mjs";

// The bundle, as ever, rather than the sources: it is what Lambda runs.
const { preTokenGeneration, resolveUserId, useClient, UID_CLAIM } = await import("../dist/index.mjs");

let db;
let close;

before(async () => {
  ({ db, close } = await freshTable());
  useClient(db);
  process.env.CALDER_TABLE = TABLE;
});

after(() => {
  useClient(undefined);
  delete process.env.CALDER_TABLE;
  // destroy() as well as close(): the SDK holds keep-alive sockets open, and
  // without this the tests pass and the process never exits.
  db?.destroy?.();
  close?.();
});

const SUB = "apple:000123.abcdef.0000";

beforeEach(async () => {
  const existing = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: identityPk(SUB), SK: SK.meta() } }),
  );
  if (existing.Item) {
    await db.send(new DeleteCommand({ TableName: TABLE, Key: { PK: identityPk(SUB), SK: SK.meta() } }));
    await db.send(
      new DeleteCommand({ TableName: TABLE, Key: { PK: userPk(existing.Item.userId), SK: SK.profile() } }),
    );
  }
});

const event = (attributes) => ({
  userPoolId: "eu-west-2_test",
  triggerSource: "TokenGeneration_Authentication",
  request: { userAttributes: { sub: SUB, ...attributes } },
  response: {},
});

test("a sub nobody has seen gets a ULID and a profile", async () => {
  const out = await preTokenGeneration(event({ name: "James" }));
  const uid = out.response.claimsOverrideDetails.claimsToAddOrOverride[UID_CLAIM];

  assert.match(uid, /^[0-9A-HJKMNP-TV-Z]{26}$/, "a Crockford base32 ULID");

  const mapping = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: identityPk(SUB), SK: SK.meta() } }),
  );
  assert.equal(mapping.Item.userId, uid);

  const profile = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: userPk(uid), SK: SK.profile() } }),
  );
  assert.equal(profile.Item.name, "James", "the name a provider gives on first authorisation only");
});

test("signing in again returns the same id, and writes nothing", async () => {
  // The whole point of the mapping. A second ULID would orphan every key built
  // on the first, and it would look like the account had been emptied.
  const first = await preTokenGeneration(event({ name: "James" }));
  const uid = first.response.claimsOverrideDetails.claimsToAddOrOverride[UID_CLAIM];

  const second = await preTokenGeneration(event({ name: "James" }));
  assert.equal(second.response.claimsOverrideDetails.claimsToAddOrOverride[UID_CLAIM], uid);

  const users = await db.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :p",
      ExpressionAttributeValues: { ":p": userPk(uid) },
    }),
  );
  assert.equal(users.Items.length, 1, "one profile, not one per sign-in");
});

test("two devices signing in at once still produce one user", async () => {
  // The mapping is written with a condition, so the loser of the race re-reads
  // and adopts the winner's id rather than minting a second one.
  const [a, b, c] = await Promise.all([
    preTokenGeneration(event({})),
    preTokenGeneration(event({})),
    preTokenGeneration(event({})),
  ]);
  const ids = new Set(
    [a, b, c].map((r) => r.response.claimsOverrideDetails.claimsToAddOrOverride[UID_CLAIM]),
  );
  assert.equal(ids.size, 1, `three sign-ins produced ${ids.size} user ids`);
});

test("a provider that gives no name leaves the field absent, not empty", async () => {
  // Apple with Hide My Email gives nothing. An empty string would be rendered
  // as a blank name; absent means the app knows to ask.
  const out = await preTokenGeneration(event({}));
  const uid = out.response.claimsOverrideDetails.claimsToAddOrOverride[UID_CLAIM];
  const profile = await db.send(
    new GetCommand({ TableName: TABLE, Key: { PK: userPk(uid), SK: SK.profile() } }),
  );
  assert.equal("name" in profile.Item, false);
});

test("an event without a sub fails the sign-in rather than issuing a token", async () => {
  await assert.rejects(
    () => preTokenGeneration({ triggerSource: "TokenGeneration_Authentication", request: { userAttributes: {} } }),
    /no sub/,
  );
});

test("a missing table fails loudly rather than issuing a token with no claim", async () => {
  // A token without the claim is worse than no token: the session works, and
  // then every handler cannot tell who is calling. That reads as data loss.
  delete process.env.CALDER_TABLE;
  try {
    await assert.rejects(() => preTokenGeneration(event({})), /CALDER_TABLE/);
  } finally {
    process.env.CALDER_TABLE = TABLE;
  }
});

test("the id is a ULID, so it sorts by creation time", async () => {
  // Several key shapes depend on this (§4.2), and it is the reason for not
  // using a random uuid.
  const one = await resolveUserId(TABLE, "sub-early", undefined, "2026-01-01T00:00:00.000Z", db);
  await new Promise((r) => setTimeout(r, 2));
  const two = await resolveUserId(TABLE, "sub-late", undefined, "2026-01-01T00:00:00.000Z", db);
  assert.ok(one < two, `${one} should sort before ${two}`);
});

test("the ULID is never the sub", async () => {
  const out = await preTokenGeneration(event({}));
  const uid = out.response.claimsOverrideDetails.claimsToAddOrOverride[UID_CLAIM];
  assert.notEqual(uid, SUB);
  assert.ok(!uid.includes("apple"), "nothing about the provider survives into the key");
});
