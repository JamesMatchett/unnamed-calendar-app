import { useSyncExternalStore } from "react";

import { isSyncing, subscribeSyncState } from "@/db/sync";

/**
 * Is a sync attempt in progress?
 *
 * Separate from useQuery, which watches the DATABASE. This watches the network
 * attempt, and the two change at different moments: a write lands locally (and
 * redraws) long before anything is sent.
 */
export const useSyncing = (): boolean =>
  useSyncExternalStore(subscribeSyncState, isSyncing, isSyncing);
