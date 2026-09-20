import assert from 'node:assert/strict';
import { test } from 'vitest';
import { env } from '../support/api-environment.ts';
import { claim, imported, markRedeemed, pool, request, space } from '../support/api-fixtures.mjs';

test('individual deletion requires ownership and unclaimed state and updates available inventory', async () => {
  const owner = await space();
  const outsider = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await imported(p, owner.cookie, 'UNUSED\nUSED\nDELETE-ME');
  const claimed = await claim(p);
  const redeemed = await claim(p);
  await markRedeemed(p, owner.cookie, redeemed.body.code);
  const rows = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items;
  const available = rows.find((row) => row.status === 'unclaimed');
  const remove = (poolId, codeId, cookie = owner.cookie) =>
    request(`/api/manage/pools/${poolId}/codes/${codeId}`, {}, cookie, env, {}, 'DELETE');
  assert.equal((await remove(p.id, available.id, '')).status, 401);
  assert.equal((await remove(p.id, available.id, outsider.cookie)).status, 404);
  assert.equal((await remove(other.id, available.id)).status, 404);
  for (const id of ['0', '-1', '1.5', 'bad', '9007199254740992'])
    assert.equal((await remove(p.id, id)).status, 404);
  for (const code of [claimed.body.code, redeemed.body.code]) {
    const row = rows.find((row) => row.code === code);
    const response = await remove(p.id, row.id);
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'CODE_NOT_AVAILABLE');
  }
  assert.equal((await remove(p.id, available.id)).status, 200);
  assert.equal((await remove(p.id, available.id)).body.code, 'CODE_NOT_FOUND');
  const stats = (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
    (row) => row.id === p.id,
  );
  assert.deepEqual([stats.total, stats.claimed, stats.remaining], [2, 2, 0]);
  assert.equal((await claim(p)).body.code, 'POOL_EMPTY');
  assert.equal((await markRedeemed(p, owner.cookie, claimed.body.code)).status, 200);
});

test('a code claimed after deletion starts is protected when the DELETE executes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'CLAIM-FIRST');
  const row = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items[0];
  let issued;
  const bindings = {
    ...env,
    DB: {
      prepare: (query) => env.DB.prepare(query),
      async batch(statements) {
        issued = await claim(p);
        assert.equal(issued.status, 200);
        return env.DB.batch(statements);
      },
    },
  };
  const removed = await request(
    `/api/manage/pools/${p.id}/codes/${row.id}`,
    {},
    owner.cookie,
    bindings,
    {},
    'DELETE',
  );
  assert.equal(issued?.body.code, 'CLAIM-FIRST');
  assert.equal(removed.status, 409);
  assert.equal(removed.body.code, 'CODE_NOT_AVAILABLE');
  const remaining = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie))
    .body;
  assert.equal(remaining.total, 1);
  assert.equal(remaining.items[0].id, row.id);
  assert.equal(remaining.items[0].status, 'claimed');
});

test('bulk deletion validates selection, enforces ownership and only removes selected unclaimed codes', async () => {
  const owner = await space();
  const outsider = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await imported(p, owner.cookie, 'BULK-UNUSED\nBULK-USED\nBULK-DELETE\nBULK-KEEP');
  await imported(other, owner.cookie, 'OTHER-POOL');
  await claim(p);
  const redeemed = await claim(p);
  await markRedeemed(p, owner.cookie, redeemed.body.code);
  const list = async (target) =>
    (await request(`/api/manage/pools/${target.id}/codes`, undefined, owner.cookie)).body.items;
  const rows = await list(p);
  const otherId = (await list(other))[0].id;
  const removable = rows.find((r) => r.code === 'BULK-DELETE');
  const remove = (json, cookie = owner.cookie) =>
    request(`/api/manage/pools/${p.id}/codes`, json, cookie, env, {}, 'DELETE');
  assert.equal((await remove({ ids: [removable.id] }, '')).status, 401);
  assert.equal((await remove({ ids: [removable.id] }, outsider.cookie)).status, 404);
  for (const ids of [
    undefined,
    [],
    '1',
    [null],
    [true],
    ['1'],
    [0],
    [-1],
    [1.5],
    [Number.MAX_SAFE_INTEGER + 1],
    Array.from({ length: 51 }, (_, i) => i + 1),
  ]) {
    const response = await remove({ ids });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_CODE_SELECTION');
  }
  const selected = rows.filter((r) => r.code !== 'BULK-KEEP').map((r) => r.id);
  const response = await remove({
    ids: [...selected, removable.id, otherId, Number.MAX_SAFE_INTEGER],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { deleted: 1, skipped: 4 });
  assert.deepEqual(
    new Set((await list(p)).map((r) => r.code)),
    new Set(['BULK-UNUSED', 'BULK-USED', 'BULK-KEEP']),
  );
  assert.equal((await list(other)).length, 1);
  assert.deepEqual((await remove({ ids: [removable.id] })).body, { deleted: 0, skipped: 1 });
  const stats = (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
    (r) => r.id === p.id,
  );
  assert.deepEqual([stats.total, stats.claimed, stats.remaining], [3, 2, 1]);
});

test('bulk deletion supports a full 50-row page in one request', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, Array.from({ length: 51 }, (_, i) => `BULK-${i}`).join('\n'));
  const page = (
    await request(`/api/manage/pools/${p.id}/codes?pageSize=50`, undefined, owner.cookie)
  ).body;
  const result = await request(
    `/api/manage/pools/${p.id}/codes`,
    { ids: page.items.map((r) => r.id) },
    owner.cookie,
    env,
    {},
    'DELETE',
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { deleted: 50, skipped: 0 });
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.total,
    1,
  );
});

test('bulk deletion skips a code claimed just before the delete statement executes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'BULK-RACE-CLAIM\nBULK-RACE-DELETE');
  const rows = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items;
  let issued;
  const bindings = {
    ...env,
    DB: {
      prepare: (query) => env.DB.prepare(query),
      async batch(statements) {
        issued = await claim(p);
        assert.equal(issued.status, 200);
        return env.DB.batch(statements);
      },
    },
  };
  const result = await request(
    `/api/manage/pools/${p.id}/codes`,
    { ids: rows.map((r) => r.id) },
    owner.cookie,
    bindings,
    {},
    'DELETE',
  );
  assert.equal(issued?.body.code, 'BULK-RACE-CLAIM');
  assert.deepEqual(result.body, { deleted: 1, skipped: 1 });
  const remaining = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
    .items;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].code, issued.body.code);
  assert.equal(remaining[0].status, 'claimed');
});

test('record counts include an empty pool and exclude every other pool and space', async () => {
  const owner = await space();
  const outsider = await space();
  const empty = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  const foreign = await pool(outsider.cookie);
  await imported(other, owner.cookie, 'OTHER-A\nOTHER-B');
  await imported(foreign, outsider.cookie, 'FOREIGN');
  const result = await request(`/api/manage/pools/${empty.id}/codes`, undefined, owner.cookie);
  assert.deepEqual(result.body.counts, { all: 0, unclaimed: 0, claimed: 0, redeemed: 0 });
  assert.equal(
    (await request(`/api/manage/pools/${other.id}/codes`, undefined, outsider.cookie)).status,
    404,
  );
  const own = await request(`/api/manage/pools/${other.id}/codes`, undefined, owner.cookie);
  assert.deepEqual(own.body.counts, { all: 2, unclaimed: 2, claimed: 0, redeemed: 0 });
});

test('code filters partition inventory into unclaimed, claimed and redeemed with matching page totals', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, Array.from({ length: 25 }, (_, i) => `STATE-${i}`).join('\n'));
  const first = await claim(p);
  const second = await claim(p);
  await markRedeemed(p, owner.cookie, first.body.code);
  const list = async (status, page = 1) => {
    const response = await request(
      `/api/manage/pools/${p.id}/codes?status=${status}&page=${page}&pageSize=20`,
      undefined,
      owner.cookie,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.counts, { all: 25, unclaimed: 23, claimed: 1, redeemed: 1 });
    return response.body;
  };
  const claimed = await list('claimed');
  assert.equal(claimed.total, 1);
  assert.equal(claimed.items[0].code, second.body.code);
  const redeemed = await list('redeemed');
  assert.equal(redeemed.total, 1);
  assert.equal(redeemed.items[0].code, first.body.code);
  assert.ok(redeemed.items[0].redeemedMarkedAt);
  const unclaimed = await list('unclaimed');
  assert.equal(unclaimed.total, 23);
  assert.equal(unclaimed.items.length, 20);
  assert.ok(unclaimed.items.every((row) => row.status === 'unclaimed'));
  const last = await list('unclaimed', 2);
  assert.equal(last.total, 23);
  assert.equal(last.items.length, 3);
  assert.equal((await list('all')).total, 25);
  assert.deepEqual((await list('all')).summary, {
    total: 25,
    remaining: 23,
    claimed: 2,
    redeemed: 1,
  });
  for (const status of ['unused', 'used']) {
    assert.equal(
      (await request(`/api/manage/pools/${p.id}/codes?status=${status}`, undefined, owner.cookie))
        .status,
      400,
    );
  }
});
