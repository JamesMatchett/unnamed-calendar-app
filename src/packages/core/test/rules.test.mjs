// Executable statements of the rules that are subtle enough to be reimplemented
// wrongly. Run with `npm test` (builds first). No test framework: node:test is
// built in, and @uca/core deliberately carries no dev dependencies beyond tsc.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SERIES_DEFAULT,
  GSI1_KEYS,
  SK,
  canDeleteEvent,
  canApproveSuggestion,
  canSuggestChange,
  isActiveMember,
  joinNeedsApproval,
  leavingWouldOrphan,
  padSeq,
  resolveRsvp,
  tallyRsvps,
} from "../dist/index.js";

const OCC = "2026-09-15T19:00:00.000Z";

test("an explicit occurrence answer beats the series default", () => {
  const single = { occurrence: OCC, status: "not_going" };
  const series = { occurrence: SERIES_DEFAULT, status: "going" };
  assert.equal(resolveRsvp(OCC, single, series).status, "not_going");
  assert.equal(resolveRsvp(OCC, single, series).source, "occurrence");
});

test("the series default covers occurrences at or after effectiveFrom", () => {
  const series = {
    occurrence: SERIES_DEFAULT,
    status: "going",
    effectiveFrom: "2026-09-10T00:00:00.000Z",
  };
  assert.equal(resolveRsvp(OCC, null, series).source, "series");
});

test("'all upcoming' does not answer retroactively", () => {
  const series = {
    occurrence: SERIES_DEFAULT,
    status: "going",
    effectiveFrom: "2026-10-01T00:00:00.000Z",
  };
  assert.equal(resolveRsvp(OCC, null, series).status, null);
});

test("no answer is a state, distinct from not_going", () => {
  assert.equal(resolveRsvp(OCC, null, null).source, "none");
  const tally = tallyRsvps(
    [
      { status: "going", item: { hasTicket: true } },
      { status: "maybe", item: null },
    ],
    6,
  );
  assert.deepEqual(
    { going: tally.going, noResponse: tally.noResponse, withTicket: tally.withTicket },
    { going: 1, noResponse: 4, withTicket: 1 },
  );
});

test("a soft-deleted membership is not permission", () => {
  assert.equal(isActiveMember({ status: "left" }), false);
  assert.equal(isActiveMember({ status: "removed" }), false);
  assert.equal(isActiveMember(undefined), false);
  assert.equal(isActiveMember({ status: "active" }), true);
});

test("a previously removed user is approved regardless of calendar policy", () => {
  assert.equal(
    joinNeedsApproval({ requireApproval: false }, { wasRemoved: true }),
    true,
  );
  assert.equal(
    joinNeedsApproval({ requireApproval: false }, { wasRemoved: false }),
    false,
  );
});

test("delete is gated on cancellation, for owners too", () => {
  const owner = { status: "active", role: "owner", userId: "U1" };
  assert.equal(canDeleteEvent({ status: "active", createdBy: "U2" }, owner), false);
  assert.equal(canDeleteEvent({ status: "cancelled", createdBy: "U2" }, owner), true);
});

test("only the event author approves suggestions", () => {
  const event = { createdBy: "AUTHOR" };
  assert.equal(canApproveSuggestion(event, "AUTHOR"), true);
  assert.equal(canApproveSuggestion(event, "AN_OWNER"), false);
});

test("disabling suggestions does not grant members a direct edit", () => {
  const member = { status: "active", role: "member", userId: "U9" };
  const event = { createdBy: "AUTHOR", allowSuggestions: false };
  assert.equal(canSuggestChange(event, member), false);
});

test("an owner may leave unless it would take the calendar to zero owners", () => {
  const soleOwner = [
    { status: "active", role: "owner", userId: "U1" },
    { status: "active", role: "member", userId: "U2" },
  ];
  const twoOwners = [
    { status: "active", role: "owner", userId: "U1" },
    { status: "active", role: "owner", userId: "U2" },
  ];
  assert.equal(leavingWouldOrphan(soleOwner, "U1"), true);
  assert.equal(leavingWouldOrphan(twoOwners, "U1"), false);
});

test("recurring series sort under their own prefix, not by start time", () => {
  assert.match(GSI1_KEYS.eventSeries("C1", "E1").GSI1SK, /^SERIES#/);
  assert.match(GSI1_KEYS.eventAtTime("C1", OCC, "E1").GSI1SK, /^T#/);
});

test("sequence numbers are padded so sort key order is numeric", () => {
  assert.ok(padSeq(9) < padSeq(10));
  assert.ok(padSeq(10) < padSeq(100));
});

test("every RSVP has one key shape, series default included", () => {
  assert.equal(SK.rsvp("E1", SERIES_DEFAULT, "U1"), "RSVP#E1#-#U1");
  assert.equal(SK.rsvp("E1", OCC, "U1"), `RSVP#E1#${OCC}#U1`);
});

test("members can add events unless the calendar is curated", async () => {
  const { canCreateEvent } = await import("../dist/index.js");
  const member = { status: "active", role: "member", userId: "U1" };
  const owner = { status: "active", role: "owner", userId: "U2" };

  assert.equal(canCreateEvent({ allowMemberEvents: true }, member), true);
  assert.equal(canCreateEvent({ allowMemberEvents: false }, member), false);
  // Turning it off restricts members, never owners.
  assert.equal(canCreateEvent({ allowMemberEvents: false }, owner), true);
  // And a departed member cannot add regardless.
  assert.equal(
    canCreateEvent({ allowMemberEvents: true }, { status: "left", role: "member" }),
    false,
  );
});
