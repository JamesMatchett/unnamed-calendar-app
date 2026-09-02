import { useCallback, useSyncExternalStore } from "react";

import { subscribe } from "@/db/client";

/**
 * Reads are synchronous because they come from local SQLite, so there is no
 * loading state to model and no spinner to show, which is the point of §5.6.
 * This hook only re-runs a query when something has been written.
 *
 * `useSyncExternalStore` demands a snapshot that is referentially STABLE between
 * notifications, so results are cached per key.
 *
 * Crucially, a recomputed result that is unchanged returns the PREVIOUS object.
 * Without that, a single write invalidates every query and hands every component
 * a new object, so the whole screen re-renders: changing one toggle visibly
 * refreshes lists that did not change. Comparing first means only the parts
 * whose data actually moved re-render.
 */
export function useQuery<T>(key: string, query: () => T): T {
  const getSnapshot = useCallback(() => snapshot(key, query), [key, query]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

interface Entry {
  serialised: string;
  value: unknown;
}

const cache = new Map<string, Entry>();
const stale = new Set<string>();

subscribe(() => {
  // Mark everything for recomputation rather than dropping it: the cached value
  // is still needed for the comparison that preserves identity.
  for (const key of cache.keys()) stale.add(key);
});

function snapshot<T>(key: string, query: () => T): T {
  const cached = cache.get(key);
  if (cached !== undefined && !stale.has(key)) return cached.value as T;

  const next = query();
  stale.delete(key);

  // Rows are plain objects out of SQLite, so a structural comparison is both
  // valid and cheap at these sizes.
  const serialised = JSON.stringify(next ?? null);
  if (cached !== undefined && cached.serialised === serialised) {
    return cached.value as T;
  }

  cache.set(key, { serialised, value: next });
  return next;
}
