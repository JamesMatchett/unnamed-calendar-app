import { autoSelection, planExport } from "@calder/core";
import { useEffect, useRef } from "react";

import {
  commitExport,
  exportableEvents,
  getSyncPrefs,
  listDeviceLinks,
} from "@/db/repo";
import {
  applyExport,
  currentPermission,
  defaultCalendarId,
} from "@/lib/deviceCalendar";
import { useQuery } from "@/lib/useQuery";

/** How long to wait after the last change before writing to the phone. */
const SETTLE_MS = 4000;

/**
 * Keeping the phone's calendar up to date on its own (§5.7).
 *
 * Mounted once at the root, so it keeps working whatever screen somebody is on.
 * That is the point of automatic: the moment worth syncing is right after an
 * event is added, and nobody adds an event from the sync screen.
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
 * It runs one at a time. Without the guard, a change arriving mid-run would
 * plan against links the previous run has not written yet, and create a second
 * copy of everything it had just made.
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
  const auto = prefs.auto;
  // Read through a ref so a preference change does not restart the timer that a
  // content change started.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

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
}
