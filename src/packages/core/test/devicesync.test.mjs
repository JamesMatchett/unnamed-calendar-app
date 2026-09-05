import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_SYNC_PREFS,
  autoImportReady,
  autoSelection,
  importsFrom,
  planExport,
  planImport,
  syncHash,
  syncsCalendar,
} from "../dist/devicesync.js";

const event = (over = {}) => ({
  eventId: "e1",
  calendarId: "c1",
  title: "Dinner",
  startUtc: "2026-09-10T18:00:00Z",
  endUtc: "2026-09-10T20:00:00Z",
  status: "active",
  precision: "datetime",
  updatedAt: null,
  ...over,
});

const chosen = (...ids) => new Set(ids);

// --- exporting --------------------------------------------------------------

test("an unlinked event is created", () => {
  const plan = planExport([event()], chosen("e1"), []);
  assert.deepEqual(plan, [{ kind: "create", eventId: "e1" }]);
});

test("a changed event is updated, not created a second time", () => {
  const links = [
    { eventId: "e1", deviceEventId: "d1", deviceCalendarId: "dc", hash: "stale" },
  ];
  const plan = planExport([event()], chosen("e1"), links);
  assert.deepEqual(plan, [{ kind: "update", eventId: "e1", deviceEventId: "d1" }]);
});

test("a link with no hash at all is updated rather than assumed current", () => {
  const links = [{ eventId: "e1", deviceEventId: "d1", deviceCalendarId: "dc" }];
  const plan = planExport([event()], chosen("e1"), links);
  assert.deepEqual(plan, [{ kind: "update", eventId: "e1", deviceEventId: "d1" }]);
});

test("running twice over unchanged events does nothing the second time", () => {
  // The duplicate-forty-copies failure and its quieter cousin, in one test:
  // the second run must neither create again nor rewrite what it wrote.
  const events = [event(), event({ eventId: "e2" })];
  const first = planExport(events, chosen("e1", "e2"), []);
  assert.ok(first.every((a) => a.kind === "create"));

  const links = first.map((a, i) => ({
    eventId: a.eventId,
    deviceEventId: `d${i}`,
    deviceCalendarId: "dc",
    hash: syncHash(events.find((e) => e.eventId === a.eventId)),
  }));
  assert.deepEqual(planExport(events, chosen("e1", "e2"), links), []);
});

test("editing an event after a sync sends exactly that one", () => {
  const events = [event(), event({ eventId: "e2" })];
  const links = events.map((e, i) => ({
    eventId: e.eventId,
    deviceEventId: `d${i}`,
    deviceCalendarId: "dc",
    hash: syncHash(e),
  }));

  const moved = [event({ startUtc: "2026-09-11T18:00:00Z" }), events[1]];
  assert.deepEqual(planExport(moved, chosen("e1", "e2"), links), [
    { kind: "update", eventId: "e1", deviceEventId: "d0" },
  ]);
});

test("the hash covers every field a copy on the phone shows", () => {
  const base = event();
  const same = syncHash(base);
  assert.equal(syncHash(event()), same);

  for (const change of [
    { title: "Lunch" },
    { startUtc: "2026-09-11T18:00:00Z" },
    { endUtc: null },
    { precision: "date" },
  ]) {
    assert.notEqual(syncHash(event(change)), same, JSON.stringify(change));
  }

  // Things the phone never sees must NOT force a rewrite.
  assert.equal(syncHash(event({ updatedAt: "2026-09-01T00:00:00Z" })), same);
  assert.equal(syncHash(event({ calendarId: "c9" })), same);
});

test("the hash survives being stored in a text column", () => {
  // The bug this replaces: the separator was a NUL, SQLite treats that as the
  // end of a string, and every stored hash was silently cut down to the title.
  // Nothing ever matched, so every run rewrote every event.
  const hash = syncHash(event({ title: "Dinner", endUtc: null }));
  // Written as code points rather than literal characters on purpose: a test
  // for invisible characters must not itself contain any.
  const codes = [...hash].map((c) => c.codePointAt(0));
  assert.ok(!codes.includes(0), "a NUL truncates the value in SQLite");
  assert.ok(
    codes.every((c) => c >= 0x20 || c === 0x09),
    "no control characters",
  );
});

test("fields cannot be shuffled between each other to fake a match", () => {
  // With a plain separator, "Drinks 8pm" with no end time hashes the same as
  // "Drinks" ending "8pm", and a real change never reaches the phone.
  const joined = event({ title: "Drinks 2026-09-10T18:00:00Z", startUtc: "" });
  const split = event({ title: "Drinks", startUtc: "2026-09-10T18:00:00Z" });
  assert.notEqual(syncHash(joined), syncHash(split));
});

test("a title containing quotes or newlines still hashes stably", () => {
  const awkward = event({ title: 'Sam\'s "big" night\nout' });
  assert.equal(syncHash(awkward), syncHash({ ...awkward }));
  assert.notEqual(syncHash(awkward), syncHash(event()));
});

test("deselecting an event removes the copy it left behind", () => {
  const links = [{ eventId: "e1", deviceEventId: "d1", deviceCalendarId: "dc" }];
  const plan = planExport([event()], chosen(), links);
  assert.deepEqual(plan, [{ kind: "remove", deviceEventId: "d1" }]);
});

test("deselecting an event that was never copied does nothing", () => {
  assert.deepEqual(planExport([event()], chosen(), []), []);
});

test("a cancelled event has its copy removed even while still chosen", () => {
  const cancelled = event({ status: "cancelled" });
  const links = [
    {
      eventId: "e1",
      deviceEventId: "d1",
      deviceCalendarId: "dc",
      // Deliberately a matching hash: an unchanged event is skipped, but a
      // cancellation is not a change to the copy, it is the end of it.
      hash: syncHash(cancelled),
    },
  ];
  assert.deepEqual(planExport([cancelled], chosen("e1"), links), [
    { kind: "remove", deviceEventId: "d1" },
  ]);
});

test("an event that loses its date has its copy removed", () => {
  const tbc = event({ precision: "tbc" });
  const links = [
    { eventId: "e1", deviceEventId: "d1", deviceCalendarId: "dc", hash: syncHash(tbc) },
  ];
  assert.deepEqual(planExport([tbc], chosen("e1"), links), [
    { kind: "remove", deviceEventId: "d1" },
  ]);
});

test("an event with no settled date is never exported", () => {
  assert.deepEqual(planExport([event({ precision: "tbc" })], chosen("e1"), []), []);
});

test("a poll that lands is exported on the next run", () => {
  const before = planExport([event({ precision: "tbc" })], chosen("e1"), []);
  assert.deepEqual(before, []);
  const after = planExport([event({ precision: "datetime" })], chosen("e1"), []);
  assert.deepEqual(after, [{ kind: "create", eventId: "e1" }]);
});

test("a copy of an event that no longer exists here is cleaned up", () => {
  const links = [{ eventId: "gone", deviceEventId: "d9", deviceCalendarId: "dc" }];
  const plan = planExport([event()], chosen("e1"), links);
  assert.deepEqual(plan, [
    { kind: "create", eventId: "e1" },
    { kind: "remove", deviceEventId: "d9" },
  ]);
});

test("an orphaned link is only removed once", () => {
  const links = [{ eventId: "gone", deviceEventId: "d9", deviceCalendarId: "dc" }];
  const removals = planExport([], chosen(), links).filter((a) => a.kind === "remove");
  assert.equal(removals.length, 1);
});

test("a date-only event exports like any other", () => {
  const plan = planExport([event({ precision: "date" })], chosen("e1"), []);
  assert.deepEqual(plan, [{ kind: "create", eventId: "e1" }]);
});

// --- importing --------------------------------------------------------------

const found = (over = {}) => ({
  deviceEventId: "d1",
  title: "Standup",
  startUtc: "2026-09-10T09:00:00Z",
  endUtc: "2026-09-10T09:15:00Z",
  allDay: false,
  ...over,
});

test("a declined invitation is not a reason to look busy", () => {
  const plan = planImport([found({ declined: true })], []);
  assert.deepEqual(plan.candidates, []);
});

test("something brought in before is counted, not offered again", () => {
  const links = [{ eventId: "e1", deviceEventId: "d1", deviceCalendarId: "dc" }];
  const plan = planImport([found()], links);
  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.alreadyHere, 1);
});

test("something new is offered", () => {
  const plan = planImport([found()], []);
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.alreadyHere, 0);
});

test("this app's own copies are never offered back", () => {
  // The bug from the screenshot: one device event was imported, then exported
  // as a second device event, and the second one turned up as a third meeting.
  const original = found({ deviceEventId: "d1", title: "Test native event" });
  const ourCopy = found({ deviceEventId: "d2", title: "Test native event" });
  const plan = planImport(
    [original, ourCopy],
    [{ eventId: "e1", deviceEventId: "d1", deviceCalendarId: "dc" }],
    [{ eventId: "e1", deviceEventId: "d2", deviceCalendarId: "dc" }],
  );

  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.alreadyHere, 1);
  assert.equal(plan.ours, 1);
});

test("our own copies are not counted as things already brought in", () => {
  // Somebody who has imported nothing must not be told that everything they
  // exported is "already here": we put it there, it is not their news.
  const plan = planImport(
    [found({ deviceEventId: "d9" })],
    [],
    [{ eventId: "e1", deviceEventId: "d9", deviceCalendarId: "dc" }],
  );
  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.alreadyHere, 0);
  assert.equal(plan.ours, 1);
});

test("all-day events are offered, not filtered away", () => {
  const plan = planImport([found({ allDay: true, title: "Birthday" })], []);
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].allDay, true);
});

test("candidates come back in time order", () => {
  const plan = planImport(
    [
      found({ deviceEventId: "c", startUtc: "2026-09-12T09:00:00Z" }),
      found({ deviceEventId: "a", startUtc: "2026-09-10T09:00:00Z" }),
      found({ deviceEventId: "b", startUtc: "2026-09-11T09:00:00Z" }),
    ],
    [],
  );
  assert.deepEqual(
    plan.candidates.map((e) => e.deviceEventId),
    ["a", "b", "c"],
  );
});

test("importing does not change what it was given", () => {
  const input = [found()];
  const copy = JSON.parse(JSON.stringify(input));
  planImport(input, []);
  assert.deepEqual(input, copy);
});

// --- the round trip ---------------------------------------------------------

test("an event that came from the phone is never sent back to it", () => {
  const events = [event({ eventId: "fromPhone" })];
  const plan = planExport(
    events,
    chosen("fromPhone"),
    [],
    new Set(["fromPhone"]),
  );
  assert.deepEqual(plan, []);
});

test("a stray copy of an imported event is cleaned off the phone", () => {
  // Repairing the damage automatic sync already did, rather than only
  // declining to do it again.
  const events = [event({ eventId: "fromPhone" })];
  const links = [
    { eventId: "fromPhone", deviceEventId: "stray", deviceCalendarId: "dc" },
  ];
  assert.deepEqual(planExport(events, chosen("fromPhone"), links, new Set(["fromPhone"])), [
    { kind: "remove", deviceEventId: "stray" },
  ]);
});

test("importing then syncing then importing again settles, with no duplicates", () => {
  // The whole loop, end to end. One meeting on the phone must stay one
  // meeting on the phone and one event here, however many times either
  // direction runs.
  const phone = [found({ deviceEventId: "d1", title: "Standup" })];
  const first = planImport(phone, [], []);
  assert.equal(first.candidates.length, 1);

  // It is brought in, becoming an event here with an inward link.
  const imported = [{ eventId: "e1", deviceEventId: "d1", deviceCalendarId: "dc" }];
  const events = [event({ eventId: "e1", title: "Standup" })];

  // Automatic sync must now find nothing to do.
  const exportPlan = planExport(
    events,
    autoSelection(events, DEFAULT_SYNC_PREFS),
    [],
    new Set(imported.map((l) => l.eventId)),
  );
  assert.deepEqual(exportPlan, []);

  // And the phone, unchanged, offers nothing new.
  const second = planImport(phone, imported, []);
  assert.deepEqual(second.candidates, []);
  assert.equal(second.alreadyHere, 1);
});

// --- preferences ------------------------------------------------------------

test("choosing nothing means every calendar, not none", () => {
  assert.equal(syncsCalendar(DEFAULT_SYNC_PREFS, "anything"), true);
});

test("choosing some calendars excludes the rest", () => {
  const prefs = { ...DEFAULT_SYNC_PREFS, calendarIds: ["c1"] };
  assert.equal(syncsCalendar(prefs, "c1"), true);
  assert.equal(syncsCalendar(prefs, "c2"), false);
});

test("the default target is the phone's own default calendar", () => {
  assert.equal(DEFAULT_SYNC_PREFS.targetCalendarId, null);
  assert.equal(DEFAULT_SYNC_PREFS.auto, false);
});

// --- the two directions default in opposite ways, on purpose ----------------

test("nothing is imported automatically until it has been chosen", () => {
  // The asymmetry that matters: empty means ALL for export and NONE for
  // import. Getting this backwards publishes somebody's work diary the first
  // time they touch the switch.
  assert.equal(DEFAULT_SYNC_PREFS.autoImport, false);
  assert.deepEqual(DEFAULT_SYNC_PREFS.importFrom, []);
  assert.equal(importsFrom(DEFAULT_SYNC_PREFS, "anything"), false);
  assert.equal(syncsCalendar(DEFAULT_SYNC_PREFS, "anything"), true);
});

test("importing reads only the phone calendars actually chosen", () => {
  const prefs = { ...DEFAULT_SYNC_PREFS, importFrom: ["work"] };
  assert.equal(importsFrom(prefs, "work"), true);
  assert.equal(importsFrom(prefs, "holidays"), false);
});

test("automatic import stays idle until it has somewhere to read from", () => {
  assert.equal(autoImportReady(DEFAULT_SYNC_PREFS), false);
  // Switched on but with nothing chosen is a no-op, not "read everything".
  assert.equal(
    autoImportReady({ ...DEFAULT_SYNC_PREFS, autoImport: true }),
    false,
  );
  assert.equal(
    autoImportReady({ ...DEFAULT_SYNC_PREFS, autoImport: true, importFrom: ["w"] }),
    true,
  );
  // And chosen calendars do nothing while the switch is off.
  assert.equal(
    autoImportReady({ ...DEFAULT_SYNC_PREFS, importFrom: ["w"] }),
    false,
  );
});

test("the default destination for imports is the person's own plans", () => {
  // Null rather than a calendar id, because their own plans is the one
  // calendar nobody else can read, and the one that always exists.
  assert.equal(DEFAULT_SYNC_PREFS.importInto, null);
});

test("an automatic run picks up only the calendars taking part", () => {
  const events = [event(), event({ eventId: "e2", calendarId: "c2" })];
  const prefs = { ...DEFAULT_SYNC_PREFS, calendarIds: ["c2"] };
  assert.deepEqual([...autoSelection(events, prefs)], ["e2"]);
});

test("an automatic run with no calendars chosen takes them all", () => {
  const events = [event(), event({ eventId: "e2", calendarId: "c2" })];
  assert.equal(autoSelection(events, DEFAULT_SYNC_PREFS).size, 2);
});

test("an automatic run still refuses undated events, through planExport", () => {
  const events = [event({ precision: "tbc" }), event({ eventId: "e2" })];
  const plan = planExport(events, autoSelection(events, DEFAULT_SYNC_PREFS), []);
  assert.deepEqual(plan, [{ kind: "create", eventId: "e2" }]);
});
