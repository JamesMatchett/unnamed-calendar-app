import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canDeleteCalendar,
  canLeaveCalendar,
  canRemoveMember,
  deleteStep,
  isPastCalendar,
} from "../dist/lifecycle.js";

test("in a shared calendar an event is called off before it is removed", () => {
  assert.equal(deleteStep({ status: "active", solo: false, allowed: true }), "cancel_first");
  assert.equal(deleteStep({ status: "cancelled", solo: false, allowed: true }), "delete");
});

test("in a calendar of one there is nobody to warn, so removing is one step", () => {
  assert.equal(deleteStep({ status: "active", solo: true, allowed: true }), "delete");
});

test("no permission, no step", () => {
  assert.equal(deleteStep({ status: "cancelled", solo: true, allowed: false }), "none");
});

test("a member may leave; the last owner may not", () => {
  assert.deepEqual(canLeaveCalendar({ role: "member", ownerCount: 1, memberCount: 3 }), { ok: true });
  assert.deepEqual(canLeaveCalendar({ role: "owner", ownerCount: 2, memberCount: 3 }), { ok: true });
  assert.deepEqual(
    canLeaveCalendar({ role: "owner", ownerCount: 1, memberCount: 3 }),
    { ok: false, reason: "last_owner" },
  );
});

test("you do not leave a calendar you are alone in", () => {
  assert.deepEqual(
    canLeaveCalendar({ role: "owner", ownerCount: 1, memberCount: 1 }),
    { ok: false, reason: "alone" },
  );
  assert.deepEqual(
    canLeaveCalendar({ role: null, ownerCount: 1, memberCount: 4 }),
    { ok: false, reason: "not_member" },
  );
});

test("owners remove members, never owners, never themselves", () => {
  assert.equal(canRemoveMember({ myRole: "owner", theirRole: "member", isSelf: false }), true);
  assert.equal(canRemoveMember({ myRole: "owner", theirRole: "owner", isSelf: false }), false);
  assert.equal(canRemoveMember({ myRole: "member", theirRole: "member", isSelf: false }), false);
  assert.equal(canRemoveMember({ myRole: "owner", theirRole: "member", isSelf: true }), false);
});

test("only an owner deletes a calendar, and never their own plans", () => {
  assert.equal(canDeleteCalendar({ role: "owner", isOwnPlans: false }), true);
  assert.equal(canDeleteCalendar({ role: "owner", isOwnPlans: true }), false);
  assert.equal(canDeleteCalendar({ role: "member", isOwnPlans: false }), false);
});

// --- past calendars ----------------------------------------------------------

const TODAY = "2026-10-25";
const NOW = "2026-10-25T12:00:00.000Z";
const over = { mode: "bounded", endDate: "2026-10-01", eventCount: 3, lastEventEnd: "2026-10-01T22:00:00.000Z" };

test("a bounded calendar is past once its dates and its events are both behind us", () => {
  assert.equal(isPastCalendar(over, TODAY, NOW), true);
});

test("a calendar with no events is never past, however old its dates", () => {
  assert.equal(isPastCalendar({ ...over, eventCount: 0, lastEventEnd: null }, TODAY, NOW), false);
});

test("dates passed but an event still to come is not past", () => {
  // The late flight home, the all-day travel event, the photos added after.
  assert.equal(isPastCalendar({ ...over, lastEventEnd: "2026-11-01T09:00:00.000Z" }, TODAY, NOW), false);
});

test("events passed but the dates have not is not past", () => {
  assert.equal(isPastCalendar({ ...over, endDate: "2026-10-30" }, TODAY, NOW), false);
  // Ending today is still today.
  assert.equal(isPastCalendar({ ...over, endDate: TODAY }, TODAY, NOW), false);
});

test("continuous calendars and calendars without an end date are never past", () => {
  assert.equal(isPastCalendar({ ...over, mode: "continuous" }, TODAY, NOW), false);
  assert.equal(isPastCalendar({ ...over, endDate: null }, TODAY, NOW), false);
});
