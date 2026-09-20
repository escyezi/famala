import assert from 'node:assert/strict';
import { test } from 'vitest';
import { withCounterUpdate } from '../../src/worker/db/counters.ts';
import { env, successfulVerification, verifier } from '../support/api-environment.ts';
import {
  claim,
  deleted,
  imported,
  markRedeemed,
  pool,
  request,
  seedCodes,
  space,
} from '../support/api-fixtures.mjs';
import { measureD1 } from '../support/d1.ts';

test('pool capacity imports valid new codes in order and counts claimed and redeemed codes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await seedCodes(p, 4980);
  const result = await imported(
    p,
    owner.cookie,
    ['seed-1', 'X'.repeat(101), ...Array.from({ length: 25 }, (_, i) => `NEW-${i}`)].join('\n'),
  );
  assert.equal(result.body.succeeded, 20);
  assert.equal(result.body.failed, 7);
  assert.deepEqual(
    result.body.failures.map((r) => [r.line, r.reasonCode]),
    [
      [1, 'DUPLICATE_IN_POOL'],
      [2, 'CODE_TOO_LONG'],
      ...Array.from({ length: 5 }, (_, i) => [23 + i, 'POOL_CODE_LIMIT']),
    ],
  );
  assert.ok(result.body.failures.slice(2).every((r) => r.params.limit === 5000));
  assert.equal((await claim(p)).status, 200);
  assert.equal((await markRedeemed(p, owner.cookie, 'seed-2')).body.marked, 1);
  const full = await imported(p, owner.cookie, 'seed-1\nOVERFLOW');
  assert.equal(full.body.succeeded, 0);
  assert.deepEqual(
    full.body.failures.map((r) => r.reasonCode),
    ['DUPLICATE_IN_POOL', 'POOL_CODE_LIMIT'],
  );
  const stats = await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie);
  assert.deepEqual(stats.body.summary, { total: 5000, remaining: 4998, claimed: 1, redeemed: 1 });
  const removable = await env.DB.prepare(
    "SELECT id FROM redemption_codes WHERE pool_id = ? AND code = 'NEW-0'",
  )
    .bind(p.id)
    .first();
  assert.equal(
    (
      await request(
        `/api/manage/pools/${p.id}/codes/${removable.id}`,
        {},
        owner.cookie,
        env,
        {},
        'DELETE',
      )
    ).status,
    200,
  );
  assert.equal((await imported(p, owner.cookie, 'REPLACEMENT\nOVERFLOW')).body.succeeded, 1);
  const other = await pool(owner.cookie);
  assert.equal((await imported(other, owner.cookie, 'OVERFLOW')).body.succeeded, 1);
});

test('concurrent imports cannot exceed 5000 codes per pool', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await seedCodes(p, 4989);
  const attempts = await Promise.all(
    Array.from({ length: 4 }, (_, batch) =>
      imported(p, owner.cookie, Array.from({ length: 25 }, (_, i) => `${batch}-${i}`).join('\n')),
    ),
  );
  assert.ok(attempts.every((r) => r.status === 200));
  assert.equal(
    attempts.reduce((sum, r) => sum + r.body.succeeded, 0),
    11,
  );
  assert.equal(
    attempts.reduce((sum, r) => sum + r.body.failed, 0),
    89,
  );
  assert.ok(
    attempts.every((r) => r.body.failures.every((f) => f.reasonCode === 'POOL_CODE_LIMIT')),
  );
  assert.equal(
    (
      await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
        .bind(p.id)
        .first()
    ).total,
    5000,
  );
});

test.each(['new', 'duplicate', 'full', 'partial'])(
  '500-code %s import fits D1 query and parameter budgets',
  async (scenario) => {
    const owner = await space();
    const p = await pool(owner.cookie);
    if (scenario !== 'new')
      await seedCodes(p, scenario === 'duplicate' ? 500 : scenario === 'full' ? 5000 : 4985);
    const text = Array.from({ length: 500 }, (_, i) =>
      scenario === 'duplicate' ? `seed-${i + 1}` : `NEW-${i}`,
    ).join('\n');
    const measured = measureD1(env.DB);
    const result = await request(`/api/manage/pools/${p.id}/import`, { text }, owner.cookie, {
      ...env,
      DB: measured.db,
    });
    assert.equal(result.status, 200);
    const expected = scenario === 'new' ? 500 : scenario === 'partial' ? 15 : 0;
    assert.equal(result.body.succeeded, expected);
    assert.equal(result.body.failed, 500 - expected);
    assert.ok(
      result.body.failures.every(
        (failure) =>
          failure.reasonCode ===
          (scenario === 'duplicate' ? 'DUPLICATE_IN_POOL' : 'POOL_CODE_LIMIT'),
      ),
    );
    assert.equal(measured.stats().queries, 39);
    assert.equal(measured.stats().maxParameters, 95);
    assert.equal(
      measured.stats().counterWrites,
      scenario === 'new' ? 12 : scenario === 'partial' ? 1 : 0,
    );
    assert.equal(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
          .bind(p.id)
          .first()
      ).total,
      scenario === 'new' || scenario === 'duplicate' ? 500 : 5000,
    );
  },
);

test.each(['duplicate deleted', 'overflow inserted'])(
  'import failure reason uses transaction state when %s after commit',
  async (scenario) => {
    const owner = await space();
    const p = await pool(owner.cookie);
    await seedCodes(p, scenario === 'duplicate deleted' ? 1 : 5000);
    const code = scenario === 'duplicate deleted' ? 'seed-1' : 'OVERFLOW';
    let changes = 0;
    const measured = measureD1(env.DB, async () => {
      changes++;
      const statements = [
        ...withCounterUpdate(
          env.DB,
          p.id,
          'deleteUnclaimed',
          env.DB.prepare("DELETE FROM redemption_codes WHERE pool_id = ? AND code = 'seed-1'").bind(
            p.id,
          ),
        ),
      ];
      if (scenario === 'overflow inserted')
        statements.push(
          ...withCounterUpdate(
            env.DB,
            p.id,
            'insert',
            env.DB.prepare(
              "INSERT INTO redemption_codes (pool_id, code, created_at) VALUES (?, 'OVERFLOW', 1)",
            ).bind(p.id),
          ),
        );
      await env.DB.batch(statements);
    });
    const result = await request(`/api/manage/pools/${p.id}/import`, { text: code }, owner.cookie, {
      ...env,
      DB: measured.db,
    });
    assert.equal(result.status, 200);
    assert.equal(changes, 1);
    assert.equal(result.body.succeeded, 0);
    assert.equal(result.body.failed, 1);
    assert.equal(
      result.body.failures[0].reasonCode,
      scenario === 'duplicate deleted' ? 'DUPLICATE_IN_POOL' : 'POOL_CODE_LIMIT',
    );
    assert.equal(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
          .bind(p.id)
          .first()
      ).total,
      scenario === 'duplicate deleted' ? 0 : 5000,
    );
  },
);

test.each([
  [
    'import',
    /WITH incoming/,
    { text: Array.from({ length: 46 }, (_, i) => `RACE-${i}`).join('\n') },
    2,
  ],
  ['name', /UPDATE OR IGNORE/, { name: 'renamed' }, 1],
  ['status', /update "code_pools" set "status"/i, { status: 'stopped' }, 1],
])(
  'deletion during %s returns 404 instead of stale success or a database error',
  async (suffix, pattern, data, deleteAt) => {
    const owner = await space();
    const p = await pool(owner.cookie);
    let calls = 0;
    const bindings = {
      ...env,
      DB: {
        async batch(statements) {
          if (++calls === deleteAt) assert.equal((await deleted(p, owner.cookie)).status, 200);
          return env.DB.batch(statements);
        },
        prepare(query) {
          const statement = env.DB.prepare(query);
          if (suffix === 'import' || !pattern.test(query)) return statement;
          return {
            bind(...params) {
              const bound = statement.bind(...params);
              const execute = async (method) => {
                if (++calls === deleteAt)
                  assert.equal((await deleted(p, owner.cookie)).status, 200);
                return bound[method]();
              };
              return { all: () => execute('all'), raw: () => execute('raw') };
            },
          };
        },
      },
    };
    const result = await request(
      `/api/manage/pools/${p.id}/${suffix}`,
      data,
      owner.cookie,
      bindings,
    );
    assert.equal(calls, deleteAt);
    assert.equal(result.status, 404);
    assert.equal(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
          .bind(p.id)
          .first()
      ).total,
      0,
    );
  },
);

test('empty pools and partial import: names, original line numbers, Unicode, duplicates, 500-row boundary', async () => {
  const owner = await space();
  const p = await pool(owner.cookie, '  九月福利  ');
  assert.equal(p.name, '九月福利');
  assert.equal(p.total, 0);
  assert.equal(p.status, 'active');
  assert.equal(
    (await request('/api/manage/pools', { name: '九月福利' }, owner.cookie)).status,
    409,
  );
  assert.equal((await request('/api/manage/pools', { name: ' \n ' }, owner.cookie)).status, 400);
  const other = await space();
  await pool(other.cookie, '九月福利');
  const result = await imported(
    p,
    owner.cookie,
    ` A \n\nA\r\n${'x'.repeat(101)}\n${'😀'.repeat(100)}\na`,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.succeeded, 3);
  assert.deepEqual(result.body.failures, [
    { line: 3, code: 'A', reasonCode: 'DUPLICATE_IN_BATCH', params: { firstLine: 1 } },
    { line: 4, code: 'x'.repeat(101), reasonCode: 'CODE_TOO_LONG' },
  ]);
  const again = await imported(p, owner.cookie, 'A\nB');
  assert.equal(again.body.failures[0].reasonCode, 'DUPLICATE_IN_POOL');
  assert.equal(again.body.succeeded, 1);
  assert.equal(again.body.failed, 1);
  const excessive = await imported(
    p,
    owner.cookie,
    Array.from({ length: 501 }, (_, i) => `large-${i}`).join('\n'),
  );
  assert.equal(excessive.status, 400);
  assert.equal((await imported(p, owner.cookie, '\n \r\n')).status, 400);
  const batch = await imported(
    p,
    owner.cookie,
    Array.from({ length: 500 }, (_, i) => `large-${i}`).join('\n'),
  );
  assert.equal(batch.status, 200);
  assert.equal(batch.body.succeeded, 500);
  const codes = await request(`/api/manage/pools/${p.id}/codes?page=1`, undefined, owner.cookie);
  assert.equal(codes.body.items.length, 50);
  assert.equal(codes.body.total, 504);
  const smaller = await request(
    `/api/manage/pools/${p.id}/codes?page=2&pageSize=20`,
    undefined,
    owner.cookie,
  );
  assert.equal(smaller.body.pageSize, 20);
  assert.equal(smaller.body.total, 504);
  assert.deepEqual(smaller.body.items, codes.body.items.slice(20, 40));
  const smallerLast = await request(
    `/api/manage/pools/${p.id}/codes?page=26&pageSize=20`,
    undefined,
    owner.cookie,
  );
  assert.equal(smallerLast.body.items.length, 4);
  const last = await request(`/api/manage/pools/${p.id}/codes?page=11`, undefined, owner.cookie);
  assert.equal(last.body.items.length, 4);
  const validation = await request('/api/claim/validate', { claimKey: p.claimKey });
  assert.deepEqual(Object.keys(validation.body).sort(), [
    'description',
    'name',
    'remaining',
    'status',
  ]);
  assert.equal(validation.body.remaining, 504);
});

test('concurrent duplicate imports never insert a duplicate code', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => imported(p, owner.cookie, 'ONE\nTWO\nTHREE')),
  );
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(
    responses.reduce((n, r) => n + r.body.succeeded, 0),
    3,
  );
});

test('redeemed import partitions results, preserves claims and changes inventory without inventing claims', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await imported(p, owner.cookie, 'A\nB\nC');
  await imported(other, owner.cookie, 'OTHER');
  const issued = await claim(p, { remark: 'preserved' });
  assert.equal(issued.body.code, 'A');
  const result = await markRedeemed(
    p,
    owner.cookie,
    ' A \r\n\nB\nB\nOTHER\nb\n' + 'X'.repeat(101) + '\nBAD\0CODE',
  );
  assert.equal(result.status, 200);
  assert.deepEqual(
    [
      result.body.marked,
      result.body.alreadyRedeemed,
      result.body.removedFromAvailable,
      result.body.failed,
    ],
    [2, 0, 1, 5],
  );
  assert.deepEqual(
    result.body.failures.map((r) => [r.line, r.reasonCode]),
    [
      [4, 'DUPLICATE_IN_BATCH'],
      [5, 'CODE_NOT_IN_POOL'],
      [6, 'CODE_NOT_IN_POOL'],
      [7, 'CODE_TOO_LONG'],
      [8, 'CODE_NULL'],
    ],
  );
  const list = async () =>
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  const before = await list();
  assert.deepEqual(before.counts, { all: 3, unclaimed: 1, claimed: 0, redeemed: 2 });
  assert.deepEqual(before.summary, { total: 3, remaining: 1, claimed: 1, redeemed: 2 });
  const a = before.items.find((row) => row.code === 'A');
  const b = before.items.find((row) => row.code === 'B');
  assert.equal(a.claimedAt, issued.body.claimedAt);
  assert.equal(a.remark, 'preserved');
  assert.equal(b.claimedAt, null);
  assert.equal(b.remark, null);
  assert.ok(a.redeemedMarkedAt);
  assert.equal(a.redeemedMarkedAt, b.redeemedMarkedAt);
  const again = await markRedeemed(p, owner.cookie, 'A\nB');
  assert.deepEqual(again.body, {
    marked: 0,
    alreadyRedeemed: 2,
    removedFromAvailable: 0,
    failed: 0,
    failures: [],
  });
  assert.deepEqual(await list(), before);
  for (const row of [a, b]) {
    assert.equal(
      (
        await request(
          `/api/manage/pools/${p.id}/codes/${row.id}`,
          {},
          owner.cookie,
          env,
          {},
          'DELETE',
        )
      ).status,
      409,
    );
  }
  assert.deepEqual(
    (
      await request(
        `/api/manage/pools/${p.id}/codes`,
        { ids: [a.id, b.id] },
        owner.cookie,
        env,
        {},
        'DELETE',
      )
    ).body,
    { deleted: 0, skipped: 2 },
  );
  const stats = (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
    (row) => row.id === p.id,
  );
  assert.deepEqual([stats.total, stats.remaining, stats.claimed, stats.redeemed], [3, 1, 1, 2]);
  assert.equal((await claim(p)).body.code, 'C');
  assert.equal((await claim(p)).body.code, 'POOL_EMPTY');
  assert.equal(
    (await request('/api/claim/validate', { claimKey: other.claimKey })).body.remaining,
    1,
  );
});

test('redeemed import validates ownership, text and limits and supports 500 Unicode codes', async () => {
  const owner = await space();
  const outsider = await space();
  const p = await pool(owner.cookie);
  assert.equal((await markRedeemed(p, undefined, 'A')).status, 401);
  assert.equal((await markRedeemed(p, outsider.cookie, 'A')).status, 404);
  assert.equal((await markRedeemed({ id: 999999 }, owner.cookie, 'A')).status, 404);
  for (const [text, reason] of [
    [null, 'IMPORT_TEXT_REQUIRED'],
    [' \n', 'IMPORT_EMPTY'],
    [Array(501).fill('A').join('\n'), 'IMPORT_LIMIT'],
  ]) {
    const result = await markRedeemed(p, owner.cookie, text);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, reason);
  }
  const missing = await markRedeemed(p, owner.cookie, 'MISSING');
  assert.deepEqual([missing.body.marked, missing.body.failed], [0, 1]);
  const codes = Array.from({ length: 500 }, (_, i) => (i === 0 ? '😀'.repeat(100) : `BATCH-${i}`));
  await imported(p, owner.cookie, codes.join('\n'));
  const result = await markRedeemed(p, owner.cookie, codes.join('\n'));
  assert.deepEqual(result.body, {
    marked: 500,
    alreadyRedeemed: 0,
    removedFromAvailable: 500,
    failed: 0,
    failures: [],
  });
  const stats = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  assert.deepEqual(stats.summary, { total: 500, remaining: 0, claimed: 0, redeemed: 500 });
});

test('redeemed import rolls back earlier chunks when a later update fails', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const codes = Array.from({ length: 70 }, (_, i) => `ROLLBACK-${i}`);
  await imported(p, owner.cookie, codes.join('\n'));
  await env.DB.prepare(
    `CREATE TRIGGER reject_redemption BEFORE UPDATE ON redemption_codes WHEN NEW.pool_id = ${p.id} AND NEW.code = 'ROLLBACK-69' BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
  ).run();
  try {
    assert.equal((await markRedeemed(p, owner.cookie, codes.join('\n'))).status, 500);
    const stats = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
    assert.deepEqual(stats.summary, { total: 70, remaining: 70, claimed: 0, redeemed: 0 });
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_redemption').run();
  }
  assert.equal((await markRedeemed(p, owner.cookie, codes.join('\n'))).body.marked, 70);
});

test('concurrent redeemed imports count each transition once', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'ONE\nTWO');
  const results = await Promise.all(
    Array.from({ length: 5 }, () => markRedeemed(p, owner.cookie, 'ONE\nTWO')),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(
    results.reduce((n, r) => n + r.body.marked, 0),
    2,
  );
  assert.equal(
    results.reduce((n, r) => n + r.body.removedFromAvailable, 0),
    2,
  );
  assert.equal(
    results.reduce((n, r) => n + r.body.alreadyRedeemed, 0),
    8,
  );
});

test('redeeming during Siteverify prevents issuance; claiming before redemption preserves the claim', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'REDEEM-FIRST');
  verifier.respond = async () => {
    assert.equal(
      (await markRedeemed(p, owner.cookie, 'REDEEM-FIRST')).body.removedFromAvailable,
      1,
    );
    return successfulVerification();
  };
  assert.equal((await claim(p)).body.code, 'POOL_EMPTY');
  verifier.respond = successfulVerification;
  await imported(p, owner.cookie, 'CLAIM-FIRST');
  let issued;
  const bindings = {
    ...env,
    DB: {
      prepare: (query) => env.DB.prepare(query),
      batch: async (statements) => {
        issued = await claim(p, { remark: 'race preserved' });
        return env.DB.batch(statements);
      },
    },
  };
  const result = await markRedeemed(p, owner.cookie, 'CLAIM-FIRST', bindings);
  assert.equal(issued.status, 200);
  assert.deepEqual([result.body.marked, result.body.removedFromAvailable], [1, 0]);
  const row = (
    await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)
  ).body.items.find((r) => r.code === 'CLAIM-FIRST');
  assert.equal(row.status, 'redeemed');
  assert.equal(row.claimedAt, issued.body.claimedAt);
  assert.equal(row.remark, 'race preserved');
});

test('redeemed import rechecks records and pool existence inside the transaction', async () => {
  const owner = await space();
  for (const deletePool of [false, true]) {
    const p = await pool(owner.cookie);
    await imported(p, owner.cookie, 'DELETE-RACE');
    const row = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body
      .items[0];
    const bindings = {
      ...env,
      DB: {
        prepare: (query) => env.DB.prepare(query),
        batch: async (statements) => {
          if (deletePool) await deleted(p, owner.cookie);
          else
            await request(
              `/api/manage/pools/${p.id}/codes/${row.id}`,
              {},
              owner.cookie,
              env,
              {},
              'DELETE',
            );
          return env.DB.batch(statements);
        },
      },
    };
    const result = await markRedeemed(p, owner.cookie, 'DELETE-RACE', bindings);
    assert.equal(result.status, deletePool ? 404 : 200);
    if (!deletePool) {
      assert.equal(result.body.marked, 0);
      assert.equal(result.body.failures[0].reasonCode, 'CODE_NOT_IN_POOL');
    }
  }
});

test('500 mixed redemption codes fit 48 queries and 62 parameters without counting no-ops', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await seedCodes(p, 4980);
  // Seed mixed states with the same transaction contract used by every writer.
  await env.DB.batch(
    withCounterUpdate(
      env.DB,
      p.id,
      'claim',
      env.DB.prepare(
        "UPDATE redemption_codes SET status = 'claimed', claimed_at = 2, remark = 'preserved' WHERE pool_id = ? AND CAST(substr(code, 6) AS INTEGER) % 2 = 0 AND CAST(substr(code, 6) AS INTEGER) <= 500",
      ).bind(p.id),
    ),
  );
  const text = Array.from({ length: 500 }, (_, i) => `seed-${i + 1}`).join('\n');
  const measured = measureD1(env.DB);
  const result = await markRedeemed(p, owner.cookie, text, { ...env, DB: measured.db });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    marked: 500,
    alreadyRedeemed: 0,
    removedFromAvailable: 250,
    failed: 0,
    failures: [],
  });
  assert.equal(measured.stats().queries, 48);
  assert.equal(measured.stats().maxParameters, 62);
  assert.equal(measured.stats().counterWrites, 18);
  const repeated = measureD1(env.DB);
  assert.equal(
    (await markRedeemed(p, owner.cookie, text, { ...env, DB: repeated.db })).body.alreadyRedeemed,
    500,
  );
  assert.equal(repeated.stats().counterWrites, 0);
  const page = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  assert.deepEqual(page.summary, { total: 4980, remaining: 4480, redeemed: 500, claimed: 250 });
  assert.equal(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM redemption_codes WHERE pool_id = ? AND claimed_at = 2 AND remark = 'preserved'",
    )
      .bind(p.id)
      .first('n'),
    250,
  );
});
