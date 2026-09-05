/**
 * Talking to the phone's own calendar (§5.7).
 *
 * Two directions, and they are not mirror images of each other:
 *
 *   OUT  Cal&der events copied into a calendar the phone already shows, so a
 *        trip turns up beside work meetings without anybody opening this app.
 *   IN   Events read off the phone and brought in, so a group can see that you
 *        are not free on Thursday without being told what you are doing.
 *
 * The whole of the hard part is doing either one twice. A sync that has no
 * memory writes a second copy every time it runs, and the person ends up
 * deleting forty duplicates by hand. So every copy is recorded as a link
 * between the two ids, and a link is what makes the second run an update
 * instead of an insert.
 *
 * Pure: no expo-calendar, no database. The client passes in what it has and
 * gets back what to do.
 */

export type SyncDirection = "out" | "in";

/** A copy this app has already made, in either direction. */
export interface SyncLink {
  readonly eventId: string;
  readonly deviceEventId: string;
  /** The device calendar it was written to, so moving it is noticed. */
  readonly deviceCalendarId: string;
  /**
   * What the event looked like when the copy was written. Absent on links made
   * before this was recorded, which is treated as "unknown", not "unchanged".
   */
  readonly hash?: string | null;
}

export interface ExportableEvent {
  readonly eventId: string;
  readonly calendarId: string;
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string | null;
  readonly status: "active" | "cancelled";
  readonly precision: "datetime" | "date" | "tbc";
  /** The last time this app changed it, for deciding what is stale. */
  readonly updatedAt: string | null;
}

export type ExportAction =
  | { readonly kind: "create"; readonly eventId: string }
  | { readonly kind: "update"; readonly eventId: string; readonly deviceEventId: string }
  | { readonly kind: "remove"; readonly deviceEventId: string };

/**
 * Everything about an event that a copy on the phone can show.
 *
 * Kept beside the copy so a second run can tell "unchanged" from "not looked
 * at". Without it every run rewrites every event it has ever written, which is
 * slow, and on iOS is visible: the calendar app animates each one as it is
 * touched, so opening the sync screen twice makes somebody's whole week flicker
 * for no reason.
 *
 * It covers exactly the fields payloadFor writes and no others. Adding a field
 * to what is written without adding it here is the way to get a change that
 * never propagates, so the two belong in the same commit, always.
 *
 * JSON rather than joining on a separator, for two reasons. A separator can
 * appear in the data, so "Drinks 8pm" with no end time could hash the same as
 * "Drinks" ending "8pm", and two different events sharing a hash is a real
 * change that never reaches the phone. And the separator has to survive being
 * stored: the first version of this joined on a NUL, which SQLite treats as the
 * end of a string, so every stored hash was silently cut down to the title
 * alone, nothing ever matched, and the rewrite-everything this exists to
 * prevent happened on every run. JSON has neither problem, and is legible in a
 * database browser, which is where anybody debugging this will be looking.
 */
export function syncHash(event: ExportableEvent): string {
  return JSON.stringify([
    event.title,
    event.startUtc,
    event.endUtc ?? "",
    event.precision,
  ]);
}

/**
 * What to do to the phone's calendar to make it match a chosen set of events.
 *
 * Three rules, each earning its place:
 *
 * An event with no link is created. An event with a link is updated rather than
 * created again, which is the entire reason links exist.
 *
 * An event that is no longer chosen, or has been called off, has its copy
 * removed. Leaving it would put a dinner nobody is going to on somebody's work
 * calendar, and the copy is ours to clean up because we made it.
 *
 * An event with no settled date is never exported. A poll that has not landed
 * is not a plan yet, and writing "TBC" into a calendar app that has no concept
 * of it produces an event at midnight that everybody has to guess about.
 *
 * An event whose copy already matches it produces nothing at all. That is what
 * makes running this twice in a row a no-op rather than a rewrite of
 * everything, which is both the honest thing for the button to say and the
 * difference between a sync that feels instant and one that does not.
 *
 * And an event that CAME from the phone is never sent back to it. This is the
 * rule that stops the loop, and without it the app is a duplicate machine: a
 * meeting is imported, becomes an event here, is exported as a second copy
 * beside the original, and that second copy is then offered for import as
 * though it were a third meeting. Passing `imported` also repairs the damage
 * where it has already happened, because an event that must not be exported
 * takes the same path as one that has been unticked, and its stray copy is
 * removed from the phone on the next run.
 */
export function planExport(
  events: readonly ExportableEvent[],
  chosen: ReadonlySet<string>,
  links: readonly SyncLink[],
  /** Events that arrived FROM the phone. The originals are already there. */
  imported: ReadonlySet<string> = new Set(),
): ExportAction[] {
  const linkFor = new Map(links.map((l) => [l.eventId, l]));
  const actions: ExportAction[] = [];

  for (const event of events) {
    const link = linkFor.get(event.eventId);
    const wanted =
      chosen.has(event.eventId) &&
      event.status === "active" &&
      event.precision !== "tbc" &&
      !imported.has(event.eventId);

    if (wanted && !link) actions.push({ kind: "create", eventId: event.eventId });
    else if (wanted && link) {
      // A link with no hash is one written before hashes existed, or by a path
      // that did not record one. Unknown is not the same as unchanged, so it
      // gets an update: rewriting one event needlessly is a great deal better
      // than never propagating a change to it.
      if (link.hash !== syncHash(event)) {
        actions.push({
          kind: "update",
          eventId: event.eventId,
          deviceEventId: link.deviceEventId,
        });
      }
    } else if (!wanted && link) {
      actions.push({ kind: "remove", deviceEventId: link.deviceEventId });
    }
  }

  // A link whose event has gone from this app entirely: the copy outlives the
  // original unless it is cleaned up here.
  const known = new Set(events.map((e) => e.eventId));
  for (const link of links) {
    if (!known.has(link.eventId)) {
      actions.push({ kind: "remove", deviceEventId: link.deviceEventId });
    }
  }

  return actions;
}

export interface DeviceEvent {
  readonly deviceEventId: string;
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string | null;
  readonly allDay: boolean;
  /** Declined invitations on the phone are not commitments. */
  readonly declined?: boolean;
}

/** Something on the phone that is not in this app yet. */
export type ImportCandidate = DeviceEvent;

export interface ImportPlan {
  /** Only what could actually be brought in. */
  readonly candidates: ImportCandidate[];
  /** Brought in by an earlier run, and left out of the list because of it. */
  readonly alreadyHere: number;
  /** Copies this app wrote to the phone, which were never the phone's news. */
  readonly ours: number;
}

/**
 * What could be brought in from the phone.
 *
 * Three kinds of thing get dropped, for three different reasons.
 *
 * Declined invitations, because a meeting you have said no to is not a reason
 * for anybody to think you are busy.
 *
 * Events this app itself wrote to the phone. These are not the phone's events
 * at all, they are our own reflection, and offering one back is how a single
 * dinner becomes two and then four. They are counted separately from everything
 * else precisely because they are not news to report: a person who has never
 * imported anything should not be told that thirty events are "already here"
 * when what is meant is that we put them there.
 *
 * And events already brought in, which is a change of mind. Marking them and
 * leaving them in the list made the two "Test native event" rows in a tester's
 * screenshot, one greyed and one not, which is a confusing way to say "this is
 * handled". A list of what you can do should hold only things you can do; the
 * count of what is already here is reported around it instead.
 *
 * Things this deliberately does NOT drop: all-day events, and events in the
 * past within the window asked for. Both are somebody else's judgement to make
 * on the screen, where they can see them, rather than a rule that quietly
 * decides a birthday is not worth importing.
 */
export function planImport(
  found: readonly DeviceEvent[],
  /** Links for events brought IN from the phone before. */
  imported: readonly SyncLink[],
  /** Links for copies this app wrote OUT to the phone. */
  exported: readonly SyncLink[] = [],
): ImportPlan {
  const here = new Set(imported.map((l) => l.deviceEventId));
  const ourCopies = new Set(exported.map((l) => l.deviceEventId));

  const candidates: ImportCandidate[] = [];
  let alreadyHere = 0;
  let ours = 0;

  for (const event of found) {
    if (event.declined) continue;
    // Checked before "already here": a copy we wrote is ours whatever else is
    // true of it, and counting it as an import would overstate what the person
    // has actually brought in.
    if (ourCopies.has(event.deviceEventId)) ours += 1;
    else if (here.has(event.deviceEventId)) alreadyHere += 1;
    else candidates.push(event);
  }

  candidates.sort((a, b) =>
    a.startUtc < b.startUtc ? -1 : a.startUtc > b.startUtc ? 1 : 0,
  );
  return { candidates, alreadyHere, ours };
}

export interface SyncPrefs {
  /** Keep the phone's calendar up to date without being asked. */
  readonly auto: boolean;
  /**
   * Which of this app's calendars take part. Empty means all of them, which is
   * different from none: a person who has chosen nothing has not opted out.
   */
  readonly calendarIds: readonly string[];
  /** Where copies are written. Null means the phone's default calendar. */
  readonly targetCalendarId: string | null;
  /** Which account that calendar belongs to, for the label on the screen. */
  readonly targetAccount: string | null;

  /** Bring new events in from the phone without being asked. */
  readonly autoImport: boolean;
  /**
   * Which Cal&der calendar they land in. Null means the person's own plans,
   * which is theirs alone, and is the only safe default: everything else can
   * be read by other people.
   */
  readonly importInto: string | null;
  /**
   * Which of the phone's calendars are read.
   *
   * Empty means NOTHING, the opposite of `calendarIds` above, and the
   * asymmetry is the point rather than an oversight. Exporting sends events
   * somebody already owns to a phone only they hold, so "all of them" is a
   * generous default. Importing takes other people's meetings off that phone
   * and puts them somewhere other people may read, so the same default would
   * quietly publish a work diary the first time the switch was touched. One
   * direction defaults to everything, the other to nothing chosen yet.
   */
  readonly importFrom: readonly string[];
}

export const DEFAULT_SYNC_PREFS: SyncPrefs = {
  auto: false,
  calendarIds: [],
  targetCalendarId: null,
  targetAccount: null,
  autoImport: false,
  importInto: null,
  importFrom: [],
};

/** Whether a calendar takes part, honouring "empty means all". */
export const syncsCalendar = (prefs: SyncPrefs, calendarId: string): boolean =>
  prefs.calendarIds.length === 0 || prefs.calendarIds.includes(calendarId);

/**
 * Whether one of the phone's calendars is read automatically.
 *
 * Empty means none. See `importFrom` for why this is the reverse of
 * syncsCalendar, and resist making them consistent: consistency here would be
 * bought by publishing somebody's private appointments.
 */
export const importsFrom = (prefs: SyncPrefs, deviceCalendarId: string): boolean =>
  prefs.importFrom.includes(deviceCalendarId);

/** Whether an automatic import would do anything at all. */
export const autoImportReady = (prefs: SyncPrefs): boolean =>
  prefs.autoImport && prefs.importFrom.length > 0;

/** The events an automatic run would write, given the preferences. */
export function autoSelection(
  events: readonly ExportableEvent[],
  prefs: SyncPrefs,
): Set<string> {
  return new Set(
    events
      .filter((e) => syncsCalendar(prefs, e.calendarId))
      .map((e) => e.eventId),
  );
}
