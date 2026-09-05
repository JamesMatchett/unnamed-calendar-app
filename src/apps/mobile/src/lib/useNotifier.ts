import type { NotificationKind } from "@calder/core";
import { notifies, plannedReminders, reminderSignature } from "@calder/core";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import type { PendingNotification } from "@/db/repo";
import {
  getNotifyPrefs,
  markNotified,
  remindableEvents,
  undeliveredNotifications,
} from "@/db/repo";
import {
  currentPermission,
  prepareAndroid,
  present,
  rescheduleReminders,
} from "@/lib/notifications";
import { useQuery } from "@/lib/useQuery";

/**
 * How far back something can be and still count as news.
 *
 * Without this, the first launch after installing an update, or after clearing
 * data, empties a week of history onto the lock screen at once. A notification
 * is not new just because this is the first time the app has looked at it.
 */
const NEWS_WINDOW_MS = 60 * 60 * 1000;

/**
 * The one place notifications leave the app (§7.3).
 *
 * Mounted at the root, and it does two jobs that share nothing but a permission.
 *
 * It keeps the phone's reminder schedule matching the events. That is a real
 * local schedule: it fires whether or not the app is running, which is what
 * makes reminders work at all.
 *
 * And it hands new inbox rows to the operating system as they appear. In
 * production those rows arrive by push and this loop is what a push handler
 * feeds; until the backend exists they arrive from the app's own writes, so the
 * delivery is honestly limited to while the app is open. Writing it this way
 * round means the seam is already in the right place: the backend adds a
 * source, not a rewrite.
 *
 * It never asks for permission. A notification sheet appearing over whatever
 * screen somebody happens to be on is how an app gets refused; the settings
 * screen asks, in the place where the question makes sense.
 */
export function useNotifier(): void {
  const prefs = useQuery("notify:prefs", () => getNotifyPrefs());

  // Recomputed only when something is written, which is exactly when the
  // schedule could have changed. The signature below decides whether that
  // recomputation is worth acting on.
  const plan = useQuery("notify:reminders", () => {
    const settings = getNotifyPrefs();
    if (!settings.enabled || settings.remindAt.length === 0) return [];
    return plannedReminders(remindableEvents(), settings.remindAt, new Date());
  });

  const pending = useQuery("notify:pending", () => {
    const settings = getNotifyPrefs();
    if (!settings.enabled) return [];
    const since = new Date(Date.now() - NEWS_WINDOW_MS).toISOString();
    return undeliveredNotifications(since).filter((n) => notifies(settings, n.kind));
  });

  const scheduled = useRef<string | null>(null);
  const delivering = useRef(false);

  useEffect(() => {
    void prepareAndroid();
  }, []);

  // --- reminders ------------------------------------------------------------

  const signature = reminderSignature(plan);

  useEffect(() => {
    let live = true;

    async function sync(): Promise<void> {
      if ((await currentPermission()) !== "granted") return;
      if (!live || scheduled.current === signature) return;
      await rescheduleReminders(plan);
      if (live) scheduled.current = signature;
    }

    void sync();

    // Coming back to the app is when a schedule that has drifted gets fixed:
    // reminders whose moment passed while the app was closed have gone, and
    // events further out have come into range of the cap.
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // Force a reschedule: the plan itself may be identical while the pending
      // list on the phone is not, because fired notifications are gone from it.
      scheduled.current = null;
      void sync();
    });

    return () => {
      live = false;
      sub.remove();
    };
  }, [signature, plan]);

  // --- news -----------------------------------------------------------------

  useEffect(() => {
    if (pending.length === 0 || delivering.current) return;
    delivering.current = true;

    void (async () => {
      try {
        if ((await currentPermission()) !== "granted") return;

        const shown: string[] = [];
        for (const item of pending) {
          const [title, body] = lockScreenText(item);
          await present(title, body);
          shown.push(item.notification_id);
        }
        // Marked after showing, never before: the other order loses a
        // notification outright if anything fails in between, and showing one
        // twice is the smaller fault.
        markNotified(shown);
      } finally {
        delivering.current = false;
      }
    })();
  }, [pending]);
}

/**
 * What a notification says on the lock screen.
 *
 * Deliberately separate from the one-liner in the Activity list, rather than
 * shared with it. A row in a list sits under a heading, beside an icon, in an
 * app somebody has already opened, so "Priya added Tram 28" is enough. A lock
 * screen has none of that context and two lines to use: the first has to say
 * which calendar this is about before the second says what happened.
 */
function lockScreenText(item: PendingNotification): [title: string, body: string] {
  const who = item.actor_name ?? "Someone";
  const what = item.event_title ?? "an event";
  const where = item.calendar_name ?? "Cal&der";

  const bodies: Record<NotificationKind, string> = {
    invite_pending: `${who} invited you to ${where}`,
    friend_request: `${who} wants to connect with you`,
    join_request: `${who} is asking to join ${where}`,
    joined_via_link: `${who} joined ${where}`,

    event_added: `${who} added ${what}`,
    poll_started: `${who} is asking when suits for ${what}`,
    rsvp_nudge: `${who} is waiting on your answer for ${what}`,

    event_cancelled: `${what} was cancelled`,
    event_deleted_by_owner: `${who} deleted ${what}`,
    suggestion_received: `${who} suggested a change to ${what}`,
    suggestion_accepted: `Your change to ${what} was accepted`,
    suggestion_rejected: `Your change to ${what} was not taken`,
    removed_from_calendar: `You were removed from ${where}`,
    ownership_granted: `${who} made you an owner of ${where}`,
    ownership_revoked: `You are no longer an owner of ${where}`,
    calendar_deleted: `${where} was deleted`,
  };

  // The title names the thing, so a glance is enough to know whether it can
  // wait. Relationship news has no calendar to name, so it says the app.
  const titles: Partial<Record<NotificationKind, string>> = {
    friend_request: "Cal&der",
  };

  return [titles[item.kind] ?? where, bodies[item.kind]];
}
