import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { readRecords, saveClaim, saveUsed, STORAGE_KEY } from '../src/react-app/storage.ts';
const memory = new Map();
let queue = Promise.resolve();
const locks = {
  request: (_name, callback) => {
    const result = queue.then(callback);
    queue = result.catch(() => {});
    return result;
  },
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  },
});
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
const record = (letter, code = letter) => ({
  claimKey: `c_${letter.repeat(43)}`,
  poolName: '测试池',
  code,
  claimedAt: 123,
  userMarkedUsed: false,
  userMarkedUsedAt: null,
});
beforeEach(() => {
  memory.clear();
  navigator.locks = locks;
});
test('simultaneous saves merge different pools without overwriting, and keep the first code for a key', async () => {
  const [first, other, conflict] = await Promise.all([
    saveClaim(record('A', 'first')),
    saveClaim(record('B')),
    saveClaim(record('A', 'second')),
  ]);
  assert.equal(first, '');
  assert.equal(other, '');
  assert.match(conflict, /另一个兑换码/);
  assert.equal(readRecords().records.length, 2);
  assert.equal(readRecords().records[0].code, 'first');
});
test('used marks only change an exact key and code match and never overwrite another code', async () => {
  await saveClaim(record('A', 'first'));
  await saveUsed(record('A', 'second'), { userMarkedUsed: true, userMarkedUsedAt: 456 });
  assert.equal(readRecords().records[0].userMarkedUsed, false);
  await saveUsed(record('A', 'first'), { userMarkedUsed: true, userMarkedUsedAt: 456 });
  assert.equal(readRecords().records[0].userMarkedUsedAt, 456);
  await saveClaim(record('A', 'first'));
  assert.equal(readRecords().records[0].userMarkedUsedAt, 456);
});
test('corrupt or inaccessible storage is reported and never silently overwritten', async () => {
  memory.set(STORAGE_KEY, '{broken');
  assert.ok(readRecords().warning);
  assert.ok(await saveClaim(record('A')));
  assert.equal(memory.get(STORAGE_KEY), '{broken');
  memory.clear();
  const original = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.match(await saveClaim(record('A')), /本地保存失败/);
  localStorage.setItem = original;
  navigator.locks = undefined;
  assert.match(await saveClaim(record('A')), /复制保存/);
});
