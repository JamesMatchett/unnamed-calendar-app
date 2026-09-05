import { useCallback, useEffect, useState } from "react";

import type { DeviceCalendar, Permission } from "@/lib/deviceCalendar";
import { ensurePermission, listDeviceCalendars } from "@/lib/deviceCalendar";

/**
 * The phone's calendars, and whether we are allowed to see them.
 *
 * Asking for the permission is part of loading rather than a separate button,
 * because on this screen there is nothing to show until it is answered and a
 * button that says "allow access" in front of an empty list is a step for its
 * own sake. If the answer is no, the screen says so and offers Settings, which
 * is the only place it can be changed from once iOS has stopped asking.
 *
 * `pending` starts true so the first frame is not an empty state that turns
 * into a list a moment later. "No calendars" and "not looked yet" are different
 * things and must not look the same.
 */
export function useDeviceCalendars(): {
  permission: Permission | null;
  calendars: DeviceCalendar[];
  pending: boolean;
  reload: () => void;
} {
  const [permission, setPermission] = useState<Permission | null>(null);
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [pending, setPending] = useState(true);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    setPending(true);

    void (async () => {
      const allowed = await ensurePermission();
      if (!live) return;
      setPermission(allowed);
      const found = allowed === "granted" ? await listDeviceCalendars() : [];
      if (!live) return;
      setCalendars(found);
      setPending(false);
    })();

    // Guards every setState after an await: the screen can be dismissed while
    // the permission sheet is still up, and writing to a gone component is a
    // warning in development and a leak in a list that reloads.
    return () => {
      live = false;
    };
  }, [round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { permission, calendars, pending, reload };
}
