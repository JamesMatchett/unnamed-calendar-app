import { useCallback, useSyncExternalStore } from "react";

import { subscribe } from "@/db/client";

/**
 * Reads are synchronous because they come from local SQLite, so there is no
 * loading state to model and no spinner to show — which is the point of §5.6.
 * This hook only re-runs the query when something is written.
 *
 * `deps` is a plain string key rather than an array so that callers are explicit
 * about what identifies the query.
 */
export function useQuery<T>(key: string, query: () => T): T {
  const getSnapshot = useCallback(() => queryCache(key, query), [key, query]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// useSyncExternalStore requires a referentially stable snapshot between
// notifications, so results are memoised per key and invalidated on change.
const cache = new Map<string, unknown>();
let generation = 0;

subscribe(() => {
  generation += 1;
  cache.clear();
});

function queryCache<T>(key: string, query: () => T): T {
  const cacheKey = `${generation}:${key}`;
  if (!cache.has(cacheKey)) cache.set(cacheKey, query());
  return cache.get(cacheKey) as T;
}
