import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { subscribe } from "@/db/client";
import { pendingMutationCount } from "@/db/repo";
import { isSyncing, syncNow } from "@/db/sync";

/** How long after the last local write before it is sent. */
const SETTLE_MS = 1500;
/** The least time between two syncs set off by coming back to the app. */
const FOREGROUND_EVERY_MS = 30 * 1000;

/**
 * Keeping the phone and the server in step on their own (§5.3, §5.6).
 *
 * Mounted once at the root, beside useAutoSync, and for the same reason: the
 * moment worth syncing is right after something is written, and nobody writes
 * from a sync screen. Three triggers, none of them a timer running on its own:
 *
 *   opening the app           a pull, so the first screen is as current as
 *                             the network allows, with no spinner for data
 *                             already here (§5.6)
 *   coming back to the app    the same, throttled, because flicking between
 *                             apps twice should not fetch twice
 *   a local write             a push, a moment later, so typing a title does
 *                             not send a request per keystroke
 *
 * Correctness never depends on any of this running (§5.6): the queue survives
 * a sync that never happens, and pull-to-refresh is the person's own trigger.
 */
export function useServerSync(): void {
  const lastForeground = useRef(0);

  useEffect(() => {
    const kick = (): void => {
      if (Date.now() - lastForeground.current < FOREGROUND_EVERY_MS) return;
      lastForeground.current = Date.now();
      void syncNow();
    };

    kick();
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") kick();
    });

    // A write happened somewhere. Wait for the typing to stop, then send
    // whatever is queued, if anything is: the sync itself writes, which
    // notifies, which lands here again with an empty queue and does nothing.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (isSyncing() || pendingMutationCount() === 0) return;
        void syncNow();
      }, SETTLE_MS);
    });

    return () => {
      app.remove();
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}
