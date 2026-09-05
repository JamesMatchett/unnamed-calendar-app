import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_NOTIFY_PREFS,
  GROUP_FOR,
  NOTIFY_GROUPS,
  REMINDER_LIMIT,
  groupFor,
  notifies,
  plannedReminders,
  reminderSignature,
} from "../dist/index.js";

const NOW = new Date("2026-09-10T09:00:00Z");

const event = (over = {}) => ({
  eventId: "e1",
  title: "Dinner",
  calendarName: "Lisbon 2027",
  startUtc: "2026-09-12T18:00:00Z",
  precision: "datetime",
  status: "active",
  ...over,
});

const at = (planned, offset) => planned.find((p) => p.offset === offset);

// --- when they fire ---------------------------------------------------------

test("an hour before is an hour before", () => {
  const [r] = plannedReminders([event()], ["1h"], NOW);
  assert.equal(r.fireAt, "2026-09-12T17:00:00.000Z");
});

test("a day before is a day before", () => {
  const [r] = plannedReminders([event()], ["1d"], NOW);
  assert.equal(r.fireAt, "2026-09-11T18:00:00.000Z");
});

test("at the start is at the start", () => {
  const [r] = plannedReminders([event()], ["start"], NOW);
  assert.equal(r.fireAt, "2026-09-12T18:00:00.000Z");
});

test("all three can be asked for at once", () => {
  const planned = plannedReminders([event()], ["start", "1h", "1d"], NOW);
  assert.equal(planned.length, 3);
  // Nearest last here, because the list comes back in firing order.
  assert.deepEqual(
    planned.map((p) => p.offset),
    ["1d", "1h", "start"],
  );
});

test("asking for nothing schedules nothing", () => {
  assert.deepEqual(plannedReminders([event()], [], NOW), []);
});

// --- all-day events ---------------------------------------------------------

const allDay = (over = {}) =>
  event({ precision: "date", startUtc: "2026-09-12T00:00:00Z", ...over });

test("an all-day event is announced in the morning, not at midnight", () => {
  // Midnight is true and useless: it arrives while you are asleep.
  const [r] = plannedReminders([allDay()], ["start"], NOW);
  assert.equal(r.fireAt, "2026-09-12T09:00:00.000Z");
});

test("the day before an all-day event is the morning before", () => {
  const [r] = plannedReminders([allDay()], ["1d"], NOW);
  assert.equal(r.fireAt, "2026-09-11T09:00:00.000Z");
});

test("an hour before an all-day event is not eleven at night", () => {
  // Taken literally it would be 23:00 the previous day, about "tomorrow",
  // which is not what anybody means by the setting.
  assert.deepEqual(plannedReminders([allDay()], ["1h"], NOW), []);
});

test("an all-day event asked for every way is not announced twice at once", () => {
  const planned = plannedReminders([allDay()], ["start", "1h", "1d"], NOW);
  assert.equal(planned.length, 2);
  assert.equal(new Set(planned.map((p) => p.fireAt)).size, 2);
});

// --- what is left out -------------------------------------------------------

test("a cancelled event does not remind anybody", () => {
  assert.deepEqual(plannedReminders([event({ status: "cancelled" })], ["1h"], NOW), []);
});

test("an event with no time yet has nothing to count down to", () => {
  assert.deepEqual(plannedReminders([event({ precision: "tbc" })], ["1h"], NOW), []);
});

test("a reminder whose moment has passed is not scheduled", () => {
  // The event is still ahead, but the day-before mark is behind us.
  const soon = event({ startUtc: "2026-09-10T20:00:00Z" });
  const planned = plannedReminders([soon], ["start", "1h", "1d"], NOW);
  assert.deepEqual(
    planned.map((p) => p.offset),
    ["1h", "start"],
  );
});

test("an event entirely in the past is skipped", () => {
  const past = event({ startUtc: "2026-09-01T18:00:00Z" });
  assert.deepEqual(plannedReminders([past], ["start", "1h", "1d"], NOW), []);
});

test("an unparseable date is skipped rather than scheduled at the epoch", () => {
  assert.deepEqual(plannedReminders([event({ startUtc: "soon" })], ["1h"], NOW), []);
});

// --- the cap ----------------------------------------------------------------

const many = (count) =>
  Array.from({ length: count }, (_, i) => {
    const day = String(11 + (i % 18)).padStart(2, "0");
    return event({
      eventId: `e${i}`,
      startUtc: `2026-09-${day}T${String(i % 24).padStart(2, "0")}:00:00Z`,
    });
  });

test("the schedule never exceeds what iOS will actually hold", () => {
  const planned = plannedReminders(many(80), ["start", "1h", "1d"], NOW);
  assert.ok(planned.length <= REMINDER_LIMIT, `${planned.length} scheduled`);
  assert.ok(REMINDER_LIMIT < 64, "must stay under the iOS limit of 64");
});

test("when the cap bites it drops the furthest away, not an arbitrary subset", () => {
  const planned = plannedReminders(many(80), ["start", "1h", "1d"], NOW, 10);
  assert.equal(planned.length, 10);

  const everything = plannedReminders(many(80), ["start", "1h", "1d"], NOW, 1000);
  const nearestTen = everything.slice(0, 10).map((p) => p.fireAt);
  assert.deepEqual(
    planned.map((p) => p.fireAt),
    nearestTen,
  );
});

test("the schedule comes back in firing order", () => {
  const planned = plannedReminders(many(40), ["start", "1h", "1d"], NOW);
  const times = planned.map((p) => p.fireAt);
  assert.deepEqual(times, [...times].sort());
});

// --- rescheduling -----------------------------------------------------------

test("an unchanged schedule has an unchanged signature", () => {
  const a = plannedReminders([event()], ["1h", "1d"], NOW);
  const b = plannedReminders([event()], ["1h", "1d"], NOW);
  assert.equal(reminderSignature(a), reminderSignature(b));
});

test("moving an event changes the signature", () => {
  const before = plannedReminders([event()], ["1h"], NOW);
  const after = plannedReminders(
    [event({ startUtc: "2026-09-12T19:00:00Z" })],
    ["1h"],
    NOW,
  );
  assert.notEqual(reminderSignature(before), reminderSignature(after));
});

test("renaming an event does NOT change the signature", () => {
  // The title is carried in the notification, but rescheduling sixty
  // notifications on every keystroke of a rename is worse than a stale title.
  const before = plannedReminders([event()], ["1h"], NOW);
  const after = plannedReminders([event({ title: "Late dinner" })], ["1h"], NOW);
  assert.equal(reminderSignature(before), reminderSignature(after));
});

// --- what the notification says ---------------------------------------------

test("the body says when, and which calendar", () => {
  const planned = plannedReminders([event()], ["start", "1h", "1d"], NOW);
  assert.equal(at(planned, "start").body, "Starting now, in Lisbon 2027");
  assert.equal(at(planned, "1h").body, "In an hour, in Lisbon 2027");
  assert.equal(at(planned, "1d").body, "Tomorrow, in Lisbon 2027");
});

test("an event with no calendar name still reads properly", () => {
  const [r] = plannedReminders([event({ calendarName: null })], ["1h"], NOW);
  assert.equal(r.body, "In an hour");
});

test("the title of the notification is the title of the event", () => {
  const [r] = plannedReminders([event({ title: "Sam's birthday" })], ["1h"], NOW);
  assert.equal(r.title, "Sam's birthday");
});

// --- which notifications are worth interrupting for -------------------------

test("every notification kind has a group", () => {
  // A Record keyed by the union, so a new kind cannot be added without
  // deciding this. The test guards the values as the types guard the keys.
  for (const [kind, group] of Object.entries(GROUP_FOR)) {
    assert.ok(NOTIFY_GROUPS.includes(group), `${kind} has an unknown group`);
  }
});

test("by default everything is on and reminders are an hour before", () => {
  assert.equal(DEFAULT_NOTIFY_PREFS.enabled, true);
  assert.deepEqual(DEFAULT_NOTIFY_PREFS.muted, []);
  assert.deepEqual(DEFAULT_NOTIFY_PREFS.remindAt, ["1h"]);
});

test("muting a group silences every kind in it and nothing else", () => {
  const prefs = { ...DEFAULT_NOTIFY_PREFS, muted: ["invitations"] };
  assert.equal(notifies(prefs, "invite_pending"), false);
  assert.equal(notifies(prefs, "friend_request"), false);
  assert.equal(notifies(prefs, "join_request"), false);
  assert.equal(notifies(prefs, "event_added"), true);
});

test("the master switch beats every group", () => {
  const prefs = { ...DEFAULT_NOTIFY_PREFS, enabled: false };
  assert.equal(notifies(prefs, "invite_pending"), false);
  assert.equal(notifies(prefs, "event_added"), false);
});

test("a group nobody has heard of arrives switched on", () => {
  // Muted rather than chosen: preferences saved before a feature existed must
  // not silently withhold it forever.
  const saved = { enabled: true, muted: ["changes"], remindAt: [] };
  assert.equal(notifies(saved, "poll_started"), true);
  assert.equal(notifies(saved, "event_cancelled"), false);
});

test("asking for times and asking for an answer are separate choices", () => {
  // The two the brief called out as needing their own notification.
  assert.notEqual(groupFor("poll_started"), groupFor("event_added"));
  assert.notEqual(groupFor("rsvp_nudge"), groupFor("event_added"));
});
