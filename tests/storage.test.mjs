import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { readRecords, saveClaim, STORAGE_KEY } from '../src/react-app/storage.ts';
const memory = new Map();
let queue = Promise.resolve();
const locks = {
  request: (_name, callback) => {
    const result = queue.then(callback);
    queue = result.catch(() => {});
    return result;
  },
};
const record = (letter, code = letter) => ({
  claimKey: `c_${letter.repeat(43)}`,
  poolName: '测试池',
  code,
  claimedAt: 123,
});
beforeEach(() => {
  memory.clear();
  queue = Promise.resolve();
  vi.stubGlobal('navigator', { locks });
  vi.stubGlobal('localStorage', {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  });
  vi.stubGlobal('window', new EventTarget());
});
test('simultaneous saves merge different pools without overwriting, and keep the first code for a key', async () => {
  const [first, other, conflict] = await Promise.all([
    saveClaim(record('A', 'first')),
    saveClaim(record('B')),
    saveClaim(record('A', 'second')),
  ]);
  assert.equal(first, null);
  assert.equal(other, null);
  assert.equal(conflict.code, 'STORAGE_CONFLICT');
  assert.equal(readRecords().records.length, 2);
  assert.equal(readRecords().records[0].code, 'first');
});
test('legacy self-reported usage fields are ignored without losing claim history', async () => {
  memory.set(
    STORAGE_KEY,
    JSON.stringify([{ ...record('A'), userMarkedUsed: true, userMarkedUsedAt: 456 }]),
  );
  assert.deepEqual(readRecords(), { records: [record('A')], warning: null });
  await saveClaim(record('B'));
  assert.deepEqual(JSON.parse(memory.get(STORAGE_KEY)), [record('A'), record('B')]);
});
test('corrupt or inaccessible storage is reported and never silently overwritten', async () => {
  memory.set(STORAGE_KEY, '{broken');
  assert.ok(readRecords().warning);
  assert.ok(await saveClaim(record('A')));
  assert.equal(memory.get(STORAGE_KEY), '{broken');
  memory.clear();
  const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  assert.equal((await saveClaim(record('A'))).code, 'STORAGE_WRITE_FAILED');
  setItem.mockRestore();
  navigator.locks = undefined;
  assert.equal((await saveClaim(record('A'))).code, 'STORAGE_UNSUPPORTED');
});
