import assert from 'node:assert/strict';
import { test } from 'vitest';
import { env } from '../support/api-environment.ts';
import { deleted, imported, markRedeemed, pool, request, space } from '../support/api-fixtures.mjs';

test('export manifest is scoped, omits secrets, freezes bounds and includes empty/stopped pools', async () => {
  const owner = await space();
  const outsider = await space();
  const full = await pool(owner.cookie, 'export full');
  const empty = await pool(owner.cookie, 'export empty');
  await imported(full, owner.cookie, '001\n002');
  await request(`/api/manage/pools/${empty.id}/status`, { status: 'stopped' }, owner.cookie);
  const manifest = await request('/api/manage/exports/manifest', undefined, owner.cookie);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('cache-control'), 'no-store');
  assert.deepEqual(
    manifest.body.pools.map((p) => p.id),
    [full.id, empty.id],
  );
  assert.equal(manifest.body.pools[1].maxId, 0);
  assert.ok(manifest.body.startedAt > 0);
  assert.deepEqual(Object.keys(manifest.body.pools[0]).sort(), ['id', 'maxId', 'name']);
  assert.equal((await request('/api/manage/exports/manifest')).status, 401);
  assert.equal(
    (await request(`/api/manage/exports/manifest?poolId=${full.id}`, undefined, outsider.cookie))
      .status,
    404,
  );
  assert.equal(
    (
      await request(
        `/api/manage/pools/${full.id}/codes/export?maxId=999999`,
        undefined,
        outsider.cookie,
      )
    ).status,
    404,
  );
  const bound = manifest.body.pools[0].maxId;
  await imported(full, owner.cookie, 'LATER');
  await pool(owner.cookie, 'later pool');
  const rows = await request(
    `/api/manage/pools/${full.id}/codes/export?maxId=${bound}`,
    undefined,
    owner.cookie,
  );
  assert.deepEqual(
    rows.body.items.map((row) => row.code),
    ['001', '002'],
  );
  assert.equal(rows.body.nextCursor, null);
  const blank = await request(
    `/api/manage/pools/${empty.id}/codes/export?maxId=0`,
    undefined,
    owner.cookie,
  );
  assert.deepEqual(blank.body, { items: [], nextCursor: null });
});

test('export cursor returns 500 rows, handles deletion and filters live states without duplicates', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, Array.from({ length: 500 }, (_, i) => `C${i}`).join('\n'));
  await imported(p, owner.cookie, 'TAIL1\nTAIL2');
  const manifest = await request(
    `/api/manage/exports/manifest?poolId=${p.id}`,
    undefined,
    owner.cookie,
  );
  const maxId = manifest.body.pools[0].maxId;
  const base = `/api/manage/pools/${p.id}/codes/export?maxId=${maxId}`;
  const first = await request(base, undefined, owner.cookie);
  assert.equal(first.body.items.length, 500);
  assert.equal(first.body.nextCursor, first.body.items[499].id);
  await markRedeemed(p, owner.cookie, 'TAIL2');
  const tail1 = await env.DB.prepare(
    'SELECT id FROM redemption_codes WHERE pool_id = ? AND code = ?',
  )
    .bind(p.id, 'TAIL1')
    .first();
  await request(`/api/manage/pools/${p.id}/codes/${tail1.id}`, {}, owner.cookie, env, {}, 'DELETE');
  const last = await request(`${base}&afterId=${first.body.nextCursor}`, undefined, owner.cookie);
  assert.equal(last.body.items.length, 1);
  assert.equal(last.body.items[0].code, 'TAIL2');
  assert.equal(last.body.items[0].status, 'redeemed');
  assert.equal(last.body.items[0].claimedAt, null);
  assert.ok(last.body.items[0].redeemedMarkedAt);
  assert.equal(last.body.nextCursor, null);
  const allIds = [...first.body.items, ...last.body.items].map((r) => r.id);
  assert.equal(new Set(allIds).size, 501);
  const unclaimed = await request(`${base}&status=unclaimed`, undefined, owner.cookie);
  assert.equal(unclaimed.body.items.length, 500);
  assert.equal(unclaimed.body.nextCursor, null);
  const redeemed = await request(`${base}&status=redeemed`, undefined, owner.cookie);
  assert.deepEqual(
    redeemed.body.items.map((r) => r.code),
    ['TAIL2'],
  );
  assert.deepEqual(
    (await request(`${base}&status=claimed`, undefined, owner.cookie)).body.items,
    [],
  );
  await deleted(p, owner.cookie);
  assert.equal((await request(base, undefined, owner.cookie)).status, 404);
});

test('export query validation rejects invalid integers, duplicates and filters', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  for (const query of [
    'poolId=',
    'poolId=0',
    'poolId=-1',
    'poolId=1&poolId=2',
    'poolId=1.5',
    'poolId=9007199254740992',
  ]) {
    const result = await request(`/api/manage/exports/manifest?${query}`, undefined, owner.cookie);
    assert.equal(result.status, 400, query);
  }
  for (const query of [
    '',
    'maxId=-1',
    'maxId=1&maxId=2',
    'maxId=2&afterId=3',
    'maxId=2&afterId=1&afterId=1',
    'maxId=2&status=nope',
    'maxId=2&status=all&status=claimed',
    'maxId=9007199254740992',
  ]) {
    const result = await request(
      `/api/manage/pools/${p.id}/codes/export?${query}`,
      undefined,
      owner.cookie,
    );
    assert.equal(result.status, 400, query);
  }
});
