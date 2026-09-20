import { expect, test } from 'vitest';
import {
  CACHE_LIMIT,
  CACHE_TTL,
  queryKey,
  readCache,
  saveCache,
} from '../../src/react-app/hooks/pool-details-cache.ts';
import type { RecordsCache } from '../../src/react-app/hooks/pool-details-cache.ts';
import { initialQuery } from '../../src/react-app/hooks/pool-details-state.ts';
import type { Snapshot } from '../../src/react-app/hooks/pool-details-state.ts';
const snapshot = (page: number): Snapshot => ({
  query: { ...initialQuery, page },
  data: {
    items: [],
    total: 0,
    page,
    pageSize: 20,
    counts: { all: 0, unclaimed: 0, claimed: 0, redeemed: 0 },
    summary: { total: 0, remaining: 0, claimed: 0, redeemed: 0 },
  },
});

test('cache expires at the TTL without mutating the input or refreshing saved time', () => {
  const original = saveCache(new Map(), snapshot(1), 100);
  const read = readCache(original, initialQuery, 100 + CACHE_TTL - 1);
  expect(read.snapshot).toEqual(snapshot(1));
  const expired = readCache(read.cache, initialQuery, 100 + CACHE_TTL);
  expect(expired.snapshot).toBeUndefined();
  expect(expired.cache.size).toBe(0);
  expect(original.size).toBe(1);
});
test('cache evicts least recently read pages and separates filters/page sizes', () => {
  let cache: RecordsCache = new Map();
  for (let page = 1; page <= CACHE_LIMIT; page++) cache = saveCache(cache, snapshot(page), 0);
  cache = readCache(cache, initialQuery, 1).cache;
  cache = saveCache(cache, snapshot(CACHE_LIMIT + 1), 1);
  expect(cache.size).toBe(CACHE_LIMIT);
  expect(cache.has(queryKey(initialQuery))).toBe(true);
  expect(cache.has(queryKey({ ...initialQuery, page: 2 }))).toBe(false);
  expect(readCache(cache, { ...initialQuery, filter: 'claimed' }, 2).snapshot).toBeUndefined();
  expect(readCache(cache, { ...initialQuery, pageSize: '50' }, 2).snapshot).toBeUndefined();
});
