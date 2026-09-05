import { autoImportReady, autoSelection, planExport, planImport } from "@calder/core";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import {
  commitExport,
  exportableEvents,
  getSyncPrefs,
  importDeviceEvents,
  importedEventIds,
  listDeviceLinks,
} from "@/db/repo";
import { OWN_PLANS_ID } from "@/db/seed";
import {
  applyExport,
  currentPermission,
  defaultCalendarId,
  readDeviceEvents,
  wallTimeIn,
} from "@/lib/deviceCalendar";
import { useQuery } from "@/lib/useQuery";

/** How long to wait after the last change before writing to the phone. */
const SETTLE_MS = 4000;
/** The least time between two automatic reads of the phone's calendar. */
const IMPORT_EVERY_MS = 5 * 60 * 1000;

/**
 * Keeping the two calendars in step on their own (§5.7).
 *
 * Mounted once at the root, so it keeps working whatever screen somebody is on.
 * That is the point of automatic: the moment worth syncing is right after an
 * event is added, and nobody adds an event from the sync screen.
 *
 * The two directions run on different signals, because they are set off by
 * different things. Sending out follows changes HERE, which the app can see the
 * instant they happen. Bringing in follows changes on the PHONE, which the app
 * cannot see at all: there is no notification when somebody accepts a meeting
 * in Mail, so the only honest options are polling and waiting for a moment
 * when looking is cheap. Coming back to the app is that moment, and it is also
 * exactly when a person would expect it to have caught up.
 *
 * Three things it deliberately will not do.
 *
 * It never asks for the calendar permission. A sheet appearing out of nowhere,
 * over whatever screen you were using, is how an app teaches people to say no.
 * If access has not been granted, automatic sync simply does not run, and the
 * sync screen is where it can be granted, in a place where the question makes
 * sense.
 *
 * It waits four seconds after the last change rather than running on each one.
 * Typing a title writes on every keystroke, and a write to the phone's calendar
 * per keystroke would be both slow and, on iOS, visible as the event flickering
 * in and out of the calendar app.
 *
 * It runs one thing at a time, across both directions. Without the guard, an
 * import landing mid-export would plan against links the export has not written
 * yet, and the two would undo each other.
 */
export function useAutoSync(): void {
  const prefs = useQuery("sync:prefs", () => getSyncPrefs());
  // A cheap fingerprint of everything that could change what belongs on the
  // phone. Comparing this rather than the event list itself means an unrelated
  // write, an RSVP or a friend request, does not set off a sync.
  //
  // The preference is read inside the query rather than around it, because this
  // runs on every write in the app: with automatic off it must cost one lookup
  // in a key/value table, not a scan of every event.
  const signature = useQuery("sync:signature", () =>
    getSyncPrefs().auto
      ? exportableEvents()
          .map(
            (e) =>
              `${e.eventId}:${e.status}:${e.precision}:${e.startUtc}:${e.updatedAt ?? ""}`,
          )
          .join("|")
      : "",
  );

  const running = useRef(false);
  const lastImport = useRef(0);
  const auto = prefs.auto;
  const importing = autoImportReady(prefs);
  // Read through a ref so a preference change does not restart the timer that a
  // content change started.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // --- out: whenever something here changes ---------------------------------

  useEffect(() => {
    if (!auto) return;

    const timer = setTimeout(() => {
      void (async () => {
        if (running.current) return;
        running.current = true;
        try {
          if ((await currentPermission()) !== "granted") return;

          const to = prefsRef.current.targetCalendarId ?? (await defaultCalendarId());
          if (!to) return;

          const events = exportableEvents();
          const plan = planExport(
            events,
            autoSelection(events, prefsRef.current),
            listDeviceLinks("out"),
            // Without this, automatic sync is a duplicate machine: it writes a
            // second copy of every event that was imported from the phone in
            // the first place, beside the original.
            new Set(importedEventIds()),
          );
          if (plan.length === 0) return;

          const result = await applyExport(plan, events, to);
          commitExport(result, to, events);
        } catch {
          // Silent on purpose. This runs without anybody having asked for it,
          // so there is nobody to tell, and the next change tries again. A
          // failure that mattered will still be visible on the sync screen,
          // where the same plan is shown before it runs.
        } finally {
          running.current = false;
        }
      })();
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [auto, signature]);

  // --- in: on opening the app, and on coming back to it ---------------------

  useEffect(() => {
    if (!importing) return;

    async function pull(): Promise<void> {
      if (running.current) return;
      // Throttled by wall clock rather than by a timer, because the trigger is
      // somebody switching apps: without this, flicking between Cal&der and
      // Mail twice would read the whole phone calendar twice.
      if (Date.now() - lastImport.current < IMPORT_EVERY_MS) return;

      running.current = true;
      try {
        if ((await currentPermission()) !== "granted") return;

        const settings = prefsRef.current;
        const found = await readDeviceEvents(settings.importFrom);
        const plan = planImport(found, listDeviceLinks("in"), listDeviceLinks("out"));
        lastImport.current = Date.now();
        if (plan.candidates.length === 0) return;

        const byId = new Map(found.map((e) => [e.deviceEventId, e]));
        importDeviceEvents(
          settings.importInto ?? OWN_PLANS_ID,
          plan.candidates.flatMap((c) => {
            const source = byId.get(c.deviceEventId);
            if (!source) return [];
            return [
              {
                deviceEventId: c.deviceEventId,
                deviceCalendarId: source.deviceCalendarId,
                title: c.title,
                startUtc: c.startUtc,
                endUtc: c.endUtc,
                localWall: wallTimeIn(c.startUtc, source.timeZone),
                tz: source.timeZone,
                allDay: c.allDay,
              },
            ];
          }),
        );
      } catch {
        // As above: nobody asked, so nobody is told. The next time the app
        // comes back to the front, it tries again.
      } finally {
        running.current = false;
      }
    }

    void pull();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void pull();
    });
    return () => sub.remove();
    // Deliberately NOT keyed on the signature: bringing events in is set off by
    // the phone changing, not by this app changing, and re-running it every
    // time somebody edits a title here would read the whole device calendar
    // over and over for no reason.
  }, [importing, prefs.importInto, prefs.importFrom]);
}
