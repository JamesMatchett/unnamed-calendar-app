import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canProposeSlot,
  isClearWinner,
  leadingSlot,
  rankSlots,
  tallySlot,
} from "../dist/scheduling.js";

const slot = (id, day) => ({ slotId: id, startUtc: `2026-10-${day}T19:00:00.000Z` });
const vote = (slotId, userId, response) => ({ slotId, userId, response });

test("a tally counts each answer and what is still outstanding", () => {
  const votes = [
    vote("s1", "a", "yes"),
    vote("s1", "b", "yes"),
    vote("s1", "c", "if_need_be"),
    vote("s1", "d", "no"),
    vote("s2", "a", "no"),
  ];

  const s1 = tallySlot("s1", votes, 6);
  assert.deepEqual(
    { yes: s1.yes, ifNeedBe: s1.ifNeedBe, no: s1.no, noResponse: s1.noResponse },
    { yes: 2, ifNeedBe: 1, no: 1, noResponse: 2 },
  );
});

test("a slot nobody has answered is all outstanding, not all no", () => {
  const s = tallySlot("s1", [], 4);
  assert.equal(s.no, 0);
  assert.equal(s.noResponse, 4);
});

test("outstanding never goes negative if extra votes arrive", () => {
  // A member leaves after voting: more votes than members. The count must not
  // wrap into a negative, which would then sort that slot to the top.
  const votes = [vote("s1", "a", "yes"), vote("s1", "b", "yes")];
  assert.equal(tallySlot("s1", votes, 1).noResponse, 0);
});

test("a keen slot beats a merely tolerated one", () => {
  const votes = [
    vote("s1", "a", "yes"),
    vote("s1", "b", "yes"),
    vote("s2", "a", "if_need_be"),
    vote("s2", "b", "if_need_be"),
    vote("s2", "c", "if_need_be"),
  ];

  const [best] = rankSlots([slot("s1", "10"), slot("s2", "11")], votes, 3);
  assert.equal(best.slotId, "s1", "two yeses beat three if-need-bes");
});

test("a no is a cost, not a shrug", () => {
  // s1: two yes, two no. s2: two yes, nobody else answered. s2 must win, or a
  // date half the group has ruled out drifts to the top.
  const votes = [
    vote("s1", "a", "yes"),
    vote("s1", "b", "yes"),
    vote("s1", "c", "no"),
    vote("s1", "d", "no"),
    vote("s2", "a", "yes"),
    vote("s2", "b", "yes"),
  ];

  const [best] = rankSlots([slot("s1", "10"), slot("s2", "11")], votes, 4);
  assert.equal(best.slotId, "s2");
});

test("ties break on the earlier date, and the order is stable", () => {
  const votes = [vote("s1", "a", "yes"), vote("s2", "a", "yes")];
  const slots = [slot("s2", "20"), slot("s1", "10")];

  for (let i = 0; i < 5; i += 1) {
    const ranked = rankSlots(slots, votes, 2);
    assert.deepEqual(ranked.map((r) => r.slotId), ["s1", "s2"]);
  }
});

test("no leader until somebody has answered", () => {
  const slots = [slot("s1", "10"), slot("s2", "11")];
  assert.equal(leadingSlot(slots, [], 4), null);
  assert.equal(leadingSlot(slots, [vote("s2", "a", "yes")], 4).slotId, "s2");
});

test("a dead heat is not announced as a winner", () => {
  const slots = [slot("s1", "10"), slot("s2", "11")];
  const tied = rankSlots(slots, [vote("s1", "a", "yes"), vote("s2", "b", "yes")], 2);
  assert.equal(isClearWinner(tied), false);

  const clear = rankSlots(slots, [vote("s1", "a", "yes"), vote("s1", "b", "yes")], 2);
  assert.equal(isClearWinner(clear), true);
});

test("a leader with no actual yes is not a winner", () => {
  // Everyone said "if need be": there is a top of the list, but nothing to
  // recommend, and saying otherwise would sell a date nobody wants.
  const slots = [slot("s1", "10")];
  const ranked = rankSlots(slots, [vote("s1", "a", "if_need_be")], 3);
  assert.equal(isClearWinner(ranked), false);
});

test("who may add a slot", () => {
  const open = { mode: "open", role: "member", isEventOwner: false };
  assert.equal(canProposeSlot(open), true, "open polls take anyone's suggestion");

  assert.equal(
    canProposeSlot({ mode: "proposed", role: "member", isEventOwner: false }),
    false,
    "a proposed poll is the organiser's shortlist",
  );
  assert.equal(
    canProposeSlot({ mode: "proposed", role: "member", isEventOwner: true }),
    true,
    "whoever added the event still runs its poll",
  );
  assert.equal(
    canProposeSlot({ mode: "proposed", role: "owner", isEventOwner: false }),
    true,
  );
  assert.equal(
    canProposeSlot({ mode: "fixed", role: "owner", isEventOwner: true }),
    false,
    "a settled event has nothing to propose against",
  );
  assert.equal(
    canProposeSlot({ mode: "open", role: null, isEventOwner: false }),
    false,
    "non-members answer nothing",
  );
});
