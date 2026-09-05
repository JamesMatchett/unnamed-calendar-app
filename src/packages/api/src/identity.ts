/**
 * Turning a Cognito `sub` into a Cal&der user id.
 *
 * §3.2's decision, and the reason this exists at all: the user id is a ULID we
 * mint, never Cognito's `sub`. Every `USER#{uid}` key, every membership and
 * every RSVP is built on it, so keying on `sub` would mean that rebuilding the
 * pool or changing identity provider invalidated the entire table. One
 * `IDENTITY#{sub}` mapping item is the whole cost of not doing that, and it
 * also makes account linking free: two subs pointing at one ULID is two items.
 *
 * The mapping is read once per token issuance rather than once per request,
 * because this runs in the Pre Token Generation trigger and the answer rides
 * out in the token.
 *
 * WHY THE ID TOKEN. Custom claims in an ACCESS token need trigger version 2,
 * and version 2 needs the Essentials feature plan — roughly $850/month more at
 * 100k MAU than Lite, bought for one claim. Version 1 runs on Lite and can
 * write to the ID token, so that is the token the API validates. The objection
 * is that an ID token describes a user rather than authorising an action, which
 * matters when you hand one to a third party; the pool and the API here are the
 * same trust domain and there is no third party. Revisit if Essentials is ever
 * needed for something else (§13, open question 1).
 *
 * MINTED HERE, LAZILY, rather than in a Post Confirmation trigger as §3.2
 * sketched. Post Confirmation does not fire for an administratively created
 * user, which is the only kind that exists before Apple and Google federation —
 * so a mint-on-confirmation design could not be exercised at all until then,
 * and would ship unexercised. Lazy also survives a user arriving by a route
 * nobody anticipated, which over a pool's lifetime is most of them.
 */

import type { CognitoSub } from "@calder/core";
import { asCognitoSub, newUserId, identityPk, userPk, SK } from "@calder/core";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

/** The claim the ULID travels in. Not `custom:`, which would imply a pool attribute (§3.2 keeps the pool thin). */
export const UID_CLAIM = "uid";

/** The subset of the V1 Pre Token Generation event this reads. */
export interface PreTokenGenerationEvent {
  readonly userPoolId?: string;
  readonly triggerSource?: string;
  readonly request?: {
    readonly userAttributes?: Readonly<Record<string, string>>;
  };
  response?: unknown;
}

let cached: DynamoDBDocumentClient | undefined;

function client(): DynamoDBDocumentClient {
  // One client per container, created on first use rather than at module load,
  // so that a cold start does no work a warm invocation would repeat and tests
  // can point it somewhere else first.
  cached ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return cached;
}

/** Tests inject their own engine; nothing else should call this. */
export function useClient(db: DynamoDBDocumentClient | undefined): void {
  cached = db;
}

/**
 * The ULID for this sub, minting it if this is the first time we have seen them.
 *
 * The write is a transaction with a condition on the mapping item, so two
 * devices signing in at the same moment cannot produce two user ids for one
 * person. The loser of that race re-reads and uses the winner's id, which is
 * why the condition failing is an ordinary outcome here and not an error.
 */
/**
 * A conditional write that lost.
 *
 * By name, not `instanceof`. An SDK error class is only ever equal to itself
 * within one copy of the SDK, and there are two the moment anything is bundled
 * — which is how this passed against the sources and failed against the bundle
 * that actually ships. The name is stable across copies, across versions, and
 * across the SDK being externalised to the runtime's own.
 */
const lostTheRace = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === "ConditionalCheckFailedException";

export async function resolveUserId(
  table: string,
  sub: CognitoSub,
  displayName: string | undefined,
  now: string,
  db: DynamoDBDocumentClient = client(),
): Promise<string> {
  const existing = await db.send(
    new GetCommand({ TableName: table, Key: { PK: identityPk(sub), SK: SK.meta() } }),
  );
  const found = existing.Item?.["userId"];
  if (typeof found === "string") return found;

  const userId = newUserId();

  // Two conditional writes rather than a transaction, and the order is the
  // design.
  //
  // The mapping goes first because it is the authoritative fact: everything in
  // the table is keyed on the ULID it holds. The profile is derived — a name
  // and a timestamp — and any handler can recreate it. So the two partial
  // states are not equally bad, and neither is bad enough to need atomicity:
  //
  //   mapping written, profile not  a user with no profile row, which the next
  //                                 request can fill in. Nothing is orphaned.
  //   mapping refused (a race)      somebody else won; adopt their id and throw
  //                                 this one away. Nothing was written.
  //
  // A transaction would remove a partial state that costs nothing to repair,
  // and it would cost something real: TransactWriteItems is not implemented by
  // the engine the tests run against, so the concurrency behaviour that matters
  // most here — two devices signing in at the same moment — could not be
  // exercised at all. An untested transaction is worth less than a tested pair
  // of writes whose failure modes are written down.
  try {
    await db.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: identityPk(sub),
          SK: SK.meta(),
          entityType: "identity",
          userId,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (cause) {
    if (!lostTheRace(cause)) throw cause;

    // Lost the race. The winner's id is the one that counts: minting a second
    // would orphan every key built on the first, and the person would
    // experience it as an emptied account.
    const winner = await db.send(
      new GetCommand({ TableName: table, Key: { PK: identityPk(sub), SK: SK.meta() } }),
    );
    const id = winner.Item?.["userId"];
    if (typeof id !== "string") throw cause;
    return id;
  }

  try {
    await db.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: userPk(userId),
          SK: SK.profile(),
          entityType: "user",
          // Apple returns a name on the FIRST authorisation only, and with Hide
          // My Email that is the single chance to capture it (§3.2). Absent
          // rather than invented when the provider says nothing: an empty
          // string renders as a blank name, absent tells the app to ask.
          ...(displayName === undefined ? {} : { name: displayName }),
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (cause) {
    // Already there is fine — this is the only writer, so it means a previous
    // attempt got this far. Anything else is not ours to swallow.
    if (!lostTheRace(cause)) throw cause;
  }

  return userId;
}

/**
 * The Pre Token Generation trigger.
 *
 * Throws rather than returning a token without the claim. A sign-in that fails
 * is a bad minute; a session whose token cannot identify its own user is an app
 * that appears to have lost everything, and it would be reported as data loss
 * rather than as a login problem.
 */
export async function preTokenGeneration(
  event: PreTokenGenerationEvent,
): Promise<PreTokenGenerationEvent> {
  const table = process.env["CALDER_TABLE"];
  if (table === undefined || table === "") {
    throw new Error("CALDER_TABLE is not set, so no identity can be resolved");
  }

  const attributes = event.request?.userAttributes ?? {};
  const sub = attributes["sub"];
  if (sub === undefined || sub === "") {
    throw new Error(`no sub in the ${event.triggerSource ?? "unknown"} event`);
  }

  const userId = await resolveUserId(
    table,
    // Branded here and nowhere else: this is the one point where a string off
    // the wire becomes an identifier. The brand is what stops a `sub` being
    // used where a ULID belongs, which §3.2 spends a whole item avoiding.
    asCognitoSub(sub),
    attributes["name"],
    new Date().toISOString(),
  );

  return {
    ...event,
    response: {
      claimsOverrideDetails: {
        claimsToAddOrOverride: { [UID_CLAIM]: userId },
      },
    },
  };
}
