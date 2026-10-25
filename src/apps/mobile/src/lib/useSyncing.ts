import { useSyncExternalStore } from "react";

import { getSyncStatus, isSyncing, subscribeSyncState, type SyncStatus } from "@/db/sync";

/**
 * Is a sync attempt in progress?
 *
 * Separate from useQuery, which watches the DATABASE. This watches the network
 * attempt, and the two change at different moments: a write lands locally (and
 * redraws) long before anything is sent.
 */
export const useSyncing = (): boolean =>
  useSyncExternalStore(subscribeSyncState, isSyncing, isSyncing);

/**
 * What the last attempt found: signed in or not, when, and what went wrong.
 * Same store as the spinner, because they change at the same moments.
 */
export const useSyncStatus = (): SyncStatus =>
  useSyncExternalStore(subscribeSyncState, getSyncStatus, getSyncStatus);
