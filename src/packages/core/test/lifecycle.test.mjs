import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canDeleteCalendar,
  canLeaveCalendar,
  canRemoveMember,
  deleteStep,
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
