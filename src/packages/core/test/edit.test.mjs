import assert from "node:assert/strict";
import { test } from "node:test";

import { canEditEvent } from "../dist/entities.js";

const ME = "u-me";
const SOMEONE = "u-priya";

test("the person who added it can edit it", () => {
  assert.equal(
    canEditEvent({ createdBy: ME, userId: ME, role: "member" }),
    true,
  );
});

test("an owner can edit anyone's event", () => {
  assert.equal(
    canEditEvent({ createdBy: SOMEONE, userId: ME, role: "owner" }),
    true,
  );
});

test("a member cannot edit someone else's event", () => {
  // They suggest instead: that asymmetry is the model (§8.1).
  assert.equal(
    canEditEvent({ createdBy: SOMEONE, userId: ME, role: "member" }),
    false,
  );
});

test("a non-member cannot edit at all, even their own past event", () => {
  // Someone removed from a calendar keeps authorship of what they added, but
  // loses every right over it.
  assert.equal(canEditEvent({ createdBy: ME, userId: ME, role: null }), false);
});

test("a cancelled event is not editable by anyone", () => {
  for (const role of ["owner", "member"]) {
    assert.equal(
      canEditEvent({ createdBy: ME, userId: ME, role, status: "cancelled" }),
      false,
      role,
    );
  }
});

test("an active event is the normal case and needs no status", () => {
  assert.equal(
    canEditEvent({ createdBy: ME, userId: ME, role: "owner", status: "active" }),
    true,
  );
});
