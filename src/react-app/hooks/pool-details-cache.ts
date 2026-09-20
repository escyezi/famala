import type { RecordsQuery, Snapshot } from './pool-details-state.ts';
export const queryKey = (query: RecordsQuery) => `${query.filter}:${query.page}:${query.pageSize}`;
export const CACHE_TTL = 60_000;
export const CACHE_LIMIT = 20;
export type RecordsCache = Map<string, { snapshot: Snapshot; savedAt: number }>;

// Return a new LRU cache; callers supply the clock so expiry/eviction is deterministic.
export function readCache(cache: RecordsCache, query: RecordsQuery, now: number) {
  const next = new Map(cache);
  const key = queryKey(query);
  const entry = next.get(key);
  next.delete(key);
  const snapshot = entry && now - entry.savedAt < CACHE_TTL ? entry.snapshot : undefined;
  if (snapshot && entry) next.set(key, entry);
  return { cache: next, snapshot };
}
export function saveCache(cache: RecordsCache, snapshot: Snapshot, now: number): RecordsCache {
  const next = new Map(cache);
  const key = queryKey(snapshot.query);
  next.delete(key);
  next.set(key, { snapshot, savedAt: now });
  while (next.size > CACHE_LIMIT) next.delete(next.keys().next().value!);
  return next;
}
