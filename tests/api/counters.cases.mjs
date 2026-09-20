import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, vi } from 'vitest';
import { env } from '../support/api-environment.ts';
import {
  claim,
  imported,
  markRedeemed,
  pool,
  request,
  seedCodes,
  seedOrderedCodes,
  space,
} from '../support/api-fixtures.mjs';
import { measureD1 } from '../support/d1.ts';
import { withRejectedCounterUpdate } from '../support/faults.ts';

test.each(['claim', 'delete', 'bulk delete', 'import', 'redeem'])(
  '%s rolls back details when the counter update fails',
  async (operation) => {
    const owner = await space();
    const p = await pool(owner.cookie);
    await imported(p, owner.cookie, 'KEEP');
    const id = await env.DB.prepare('SELECT id FROM redemption_codes WHERE pool_id = ?')
      .bind(p.id)
      .first('id');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await withRejectedCounterUpdate(env.DB, p.id, async () => {
      const result =
        operation === 'claim'
          ? await claim(p)
          : operation === 'import'
            ? await imported(p, owner.cookie, 'NEW')
            : operation === 'redeem'
              ? await markRedeemed(p, owner.cookie, 'KEEP')
              : await request(
                  `/api/manage/pools/${p.id}/codes${operation === 'delete' ? `/${id}` : ''}`,
                  operation === 'delete' ? {} : { ids: [id] },
                  owner.cookie,
                  env,
                  {},
                  'DELETE',
                );
      assert.equal(result.status, 500);
      const rows = await env.DB.prepare(
        'SELECT code, status FROM redemption_codes WHERE pool_id = ?',
      )
        .bind(p.id)
        .all();
      assert.deepEqual(rows.results, [{ code: 'KEEP', status: 'unclaimed' }]);
      assert.deepEqual(
        (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.summary,
        { total: 1, remaining: 1, redeemed: 0, claimed: 0 },
      );
    });
    log.mockRestore();
  },
);

test('ordinary import retains committed chunks when the next chunk counter update fails', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await withRejectedCounterUpdate(
    env.DB,
    p.id,
    async () => {
      const result = await imported(
        p,
        owner.cookie,
        Array.from({ length: 90 }, (_, i) => `PART-${i}`).join('\n'),
      );
      assert.equal(result.status, 500);
      assert.equal(
        await env.DB.prepare('SELECT count(*) AS n FROM redemption_codes WHERE pool_id = ?')
          .bind(p.id)
          .first('n'),
        45,
      );
      assert.equal(
        await env.DB.prepare('SELECT total_count FROM code_pools WHERE id = ?')
          .bind(p.id)
          .first('total_count'),
        45,
      );
    },
    45,
  );
  log.mockRestore();
});

test('counter reads stay bounded as a pool grows and capacity checks do not scan existing codes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const readStats = async () => {
    const measured = measureD1(env.DB);
    const bindings = { ...env, DB: measured.db };
    const publicResult = await request(
      '/api/claim/validate',
      { claimKey: p.claimKey },
      undefined,
      bindings,
    );
    assert.equal(publicResult.status, 200);
    assert.equal(measured.stats().queries, 1);
    const publicReads = measured.stats().rowsRead;
    assert.ok(publicReads > 0 && publicReads <= 10);
    assert.ok(measured.stats().executions.every((r) => !/redemption_codes/i.test(r.query)));
    await request('/api/manage/pools', undefined, owner.cookie, bindings);
    assert.ok(measured.stats().executions.every((r) => !/redemption_codes/i.test(r.query)));
    return { publicReads, listReads: measured.stats().rowsRead - publicReads };
  };
  const empty = await readStats();
  await seedCodes(p, 5000);
  const full = await readStats();
  assert.deepEqual(full, empty);
  const pageMetrics = measureD1(env.DB);
  await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie, {
    ...env,
    DB: pageMetrics.db,
  });
  assert.equal(
    pageMetrics.stats().executions.filter((r) => /redemption_codes/i.test(r.query)).length,
    1,
  );
  const importStats = [];
  for (const existing of [0, 4500]) {
    const target = await pool(owner.cookie);
    if (existing) await seedCodes(target, existing);
    const measured = measureD1(env.DB);
    const result = await request(
      `/api/manage/pools/${target.id}/import`,
      { text: Array.from({ length: 500 }, (_, i) => `NEW-${i}`).join('\n') },
      owner.cookie,
      { ...env, DB: measured.db },
    );
    assert.equal(result.body.succeeded, 500);
    assert.ok(measured.stats().executions.every((r) => !/count\s*\(/i.test(r.query)));
    importStats.push({
      existing,
      reads: measured.stats().rowsRead,
      writes: measured.stats().rowsWritten,
    });
  }
  assert.ok(importStats[1].reads <= importStats[0].reads + 100);
  assert.ok(importStats[0].reads > 0 && importStats[0].writes >= 500);
  console.info('Local D1 counter metrics', JSON.stringify({ empty, full, importStats }));
});

test('ordered pages, claims and exports preserve timestamp ties, pool boundaries and every state', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await seedOrderedCodes(p, 90);
  await seedOrderedCodes(other, 90);
  const records = (
    await env.DB.prepare('SELECT * FROM redemption_codes WHERE pool_id = ?').bind(p.id).all()
  ).results;
  const maxId = Math.max(...records.map((r) => r.id));
  for (const status of ['all', 'unclaimed', 'claimed', 'redeemed']) {
    const filtered = records.filter((r) => status === 'all' || r.status === status);
    const descending = [...filtered].sort((a, b) => b.created_at - a.created_at || b.id - a.id);
    const actual = [];
    for (let page = 1; page <= Math.ceil(filtered.length / 20); page++) {
      const result = await request(
        `/api/manage/pools/${p.id}/codes?status=${status}&pageSize=20&page=${page}`,
        undefined,
        owner.cookie,
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.total, filtered.length);
      actual.push(...result.body.items.map((r) => r.id));
    }
    assert.deepEqual(
      actual,
      descending.map((r) => r.id),
    );
    const exported = await request(
      `/api/manage/pools/${p.id}/codes/export?maxId=${maxId}&status=${status}`,
      undefined,
      owner.cookie,
    );
    assert.equal(exported.status, 200);
    assert.deepEqual(
      exported.body.items.map((r) => r.id),
      filtered.map((r) => r.id).sort((a, b) => a - b),
    );
    assert.equal(exported.body.nextCursor, null);
  }
  const available = records
    .filter((r) => r.status === 'unclaimed')
    .sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  for (const expected of available.slice(0, 3)) {
    const result = await claim(p);
    assert.equal(result.status, 200);
    assert.equal(result.body.code, expected.code);
  }
  assert.equal(
    await env.DB.prepare('SELECT claimed_total_count FROM code_pools WHERE id = ?')
      .bind(other.id)
      .first('claimed_total_count'),
    30,
  );
});

test('order indexes bound D1 first-page and claim reads and record write overhead', async () => {
  // This proxy uses persist:false. Index changes only affect this test's temporary
  // database; restore them even when an assertion fails.
  const migration = (await readFile('drizzle/0003_code_order_indexes.sql', 'utf8'))
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  const measure = async (operation) => {
    const measured = measureD1(env.DB);
    const result = await operation({ ...env, DB: measured.db });
    assert.equal(result.status, 200);
    const stats = measured.stats();
    return {
      reads: stats.executions
        .filter((r) => /redemption_codes/.test(r.query))
        .reduce((sum, r) => sum + r.meta.rows_read, 0),
      writes: stats.rowsWritten,
    };
  };
  const sample = async () => {
    const owner = await space();
    const samples = {};
    for (const size of [90, 5000]) {
      const p = await pool(owner.cookie);
      await seedOrderedCodes(p, size);
      const pages = {};
      for (const status of ['all', 'unclaimed', 'claimed', 'redeemed']) {
        pages[status] = await measure((bindings) =>
          request(
            `/api/manage/pools/${p.id}/codes?status=${status}&pageSize=20`,
            undefined,
            owner.cookie,
            bindings,
          ),
        );
      }
      const allocation = await measure((bindings) => claim(p, {}, bindings));
      samples[size] = { pages, claim: allocation };
    }
    const target = await pool(owner.cookie);
    const writes = {};
    writes.import = await measure((bindings) =>
      request(
        `/api/manage/pools/${target.id}/import`,
        { text: Array.from({ length: 45 }, (_, i) => `MEASURE-${i}`).join('\n') },
        owner.cookie,
        bindings,
      ),
    );
    const allocated = await claim(target);
    assert.equal(allocated.body.code, 'MEASURE-0');
    writes.redeemUnclaimed = await measure((bindings) =>
      markRedeemed(target, owner.cookie, 'MEASURE-1', bindings),
    );
    writes.redeemClaimed = await measure((bindings) =>
      markRedeemed(target, owner.cookie, allocated.body.code, bindings),
    );
    const id = await env.DB.prepare(
      "SELECT id FROM redemption_codes WHERE pool_id = ? AND code = 'MEASURE-2'",
    )
      .bind(target.id)
      .first('id');
    writes.delete = await measure((bindings) =>
      request(
        `/api/manage/pools/${target.id}/codes/${id}`,
        {},
        owner.cookie,
        bindings,
        {},
        'DELETE',
      ),
    );
    return { samples, writes };
  };
  try {
    await env.DB.batch([
      env.DB.prepare('CREATE INDEX codes_pool_status_idx ON redemption_codes(pool_id, status)'),
      env.DB.prepare('DROP INDEX codes_pool_status_created_id_idx'),
      env.DB.prepare('DROP INDEX codes_pool_created_id_idx'),
    ]);
    const before = await sample();
    await env.DB.batch(migration.map((sql) => env.DB.prepare(sql)));
    const after = await sample();
    console.info('Local D1 order index metrics', JSON.stringify({ before, after }));
    for (const status of ['all', 'unclaimed', 'claimed', 'redeemed']) {
      const large = after.samples[5000].pages[status].reads;
      assert.ok(large > 0 && large <= 100, `${status}: ${large} reads`);
      assert.ok(large <= after.samples[90].pages[status].reads + 5);
      assert.ok(large < before.samples[5000].pages[status].reads / 10);
    }
    assert.ok(after.samples[5000].claim.reads <= after.samples[90].claim.reads + 5);
    assert.ok(after.samples[5000].claim.reads < before.samples[5000].claim.reads / 10);
    assert.ok(after.writes.import.writes > before.writes.import.writes);
    for (const result of Object.values(after.writes)) assert.ok(result.writes > 0);
  } finally {
    await env.DB.batch([
      ...migration
        .slice(0, 2)
        .map((sql) => env.DB.prepare(sql.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS'))),
      env.DB.prepare('DROP INDEX IF EXISTS codes_pool_status_idx'),
    ]);
  }
});
