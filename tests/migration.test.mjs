import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'vitest';

async function initializedDatabase() {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(await readFile('drizzle/0000_initial.sql', 'utf8'));
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

test('migration journal lists all migrations and the initial migration matches its schema snapshot', async () => {
  assert.deepEqual((await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort(), [
    '0000_initial.sql',
    '0001_export_cursor_index.sql',
    '0002_pool_counters.sql',
    '0003_code_order_indexes.sql',
  ]);
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
  assert.deepEqual(
    journal.entries.map(({ idx, tag }) => ({ idx, tag })),
    [
      { idx: 0, tag: '0000_initial' },
      { idx: 1, tag: '0001_export_cursor_index' },
      { idx: 2, tag: '0002_pool_counters' },
      { idx: 3, tag: '0003_code_order_indexes' },
    ],
  );
  const snapshot = JSON.parse(await readFile('drizzle/meta/0000_snapshot.json', 'utf8'));
  assert.equal(snapshot.prevId, '00000000-0000-0000-0000-000000000000');
  assert.deepEqual(snapshot._meta.columns, {});
  const db = await initializedDatabase();
  try {
    assert.deepEqual(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name),
      ['code_pools', 'distributor_sessions', 'distributor_spaces', 'redemption_codes'],
    );
    const poolColumns = db.prepare('PRAGMA table_info(code_pools)').all();
    assert.deepEqual(
      poolColumns.map((column) => column.name),
      Object.keys(snapshot.tables.code_pools.columns),
    );
    const description = poolColumns.find((column) => column.name === 'description');
    assert.equal(description.type, 'TEXT');
    assert.equal(description.notnull, 0);
    const columns = db
      .prepare('PRAGMA table_info(redemption_codes)')
      .all()
      .map((row) => row.name);
    assert.deepEqual(columns, [
      'id',
      'pool_id',
      'code',
      'status',
      'claimed_at',
      'remark',
      'redeemed_marked_at',
      'created_at',
    ]);
    assert.deepEqual(columns, Object.keys(snapshot.tables.redemption_codes.columns));
  } finally {
    db.close();
  }
});

test('initial schema enforces unified states and preserves non-reusable generated IDs', async () => {
  const db = await initializedDatabase();
  try {
    db.exec(`INSERT INTO distributor_spaces (id, key_hash, created_at) VALUES (1, 'hash', 1);
      INSERT INTO code_pools (id, space_id, name, claim_key, created_at) VALUES (1, 1, 'pool', 'key', 1);
      INSERT INTO redemption_codes (pool_id, code, created_at) VALUES (1, 'AVAILABLE', 1);`);
    const row = db.prepare('SELECT * FROM redemption_codes').get();
    assert.equal(row.status, 'unclaimed');
    assert.equal(row.claimed_at, null);
    assert.equal(row.remark, null);
    assert.equal(row.redeemed_marked_at, null);
    for (const update of [
      "status = 'unknown'",
      "status = 'claimed'",
      "status = 'redeemed'",
      'redeemed_marked_at = 4',
      'claimed_at = 4',
      "remark = 'invalid'",
    ])
      assert.throws(
        () => db.exec(`UPDATE redemption_codes SET ${update}`),
        /CHECK constraint failed/,
      );
    db.exec("UPDATE redemption_codes SET status = 'redeemed', redeemed_marked_at = 5");
    assert.equal(db.prepare('SELECT claimed_at FROM redemption_codes').get().claimed_at, null);
    db.exec(
      "INSERT INTO redemption_codes (pool_id, code, status, claimed_at, remark, created_at) VALUES (1, 'CLAIMED', 'claimed', 3, 'hello', 1)",
    );
    db.exec(
      "UPDATE redemption_codes SET status = 'redeemed', redeemed_marked_at = 5 WHERE code = 'CLAIMED'",
    );
    const claimed = db.prepare("SELECT * FROM redemption_codes WHERE code = 'CLAIMED'").get();
    assert.equal(claimed.claimed_at, 3);
    assert.equal(claimed.remark, 'hello');
    assert.throws(
      () =>
        db.exec(
          "INSERT INTO redemption_codes (pool_id, code, created_at) VALUES (1, 'AVAILABLE', 6)",
        ),
      /UNIQUE constraint failed/,
    );
    db.exec('DELETE FROM redemption_codes');
    db.exec("INSERT INTO redemption_codes (pool_id, code, created_at) VALUES (1, 'NEW', 6)");
    assert.ok(db.prepare('SELECT id FROM redemption_codes').get().id > claimed.id);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('export index migration preserves data and serves cursor scans', async () => {
  const db = await initializedDatabase();
  try {
    db.exec("INSERT INTO distributor_spaces VALUES (1, 'hash', 1)");
    db.exec(
      "INSERT INTO code_pools (id, space_id, name, claim_key, created_at) VALUES (1, 1, 'pool', 'key', 1)",
    );
    db.exec("INSERT INTO redemption_codes (pool_id, code, created_at) VALUES (1, '001', 1)");
    db.exec(await readFile('drizzle/0001_export_cursor_index.sql', 'utf8'));
    assert.equal(db.prepare('SELECT code FROM redemption_codes').get().code, '001');
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM redemption_codes WHERE pool_id = 1 AND id > 0 AND id <= 5000 ORDER BY id LIMIT 501',
      )
      .all();
    assert.ok(plan.some((row) => row.detail.includes('codes_pool_id_idx')));
    assert.ok(plan.every((row) => !row.detail.includes('TEMP B-TREE')));
  } finally {
    db.close();
  }
});

test('counter migration backfills all states, preserves data and adds no triggers', async () => {
  const db = await initializedDatabase();
  try {
    db.exec(await readFile('drizzle/0001_export_cursor_index.sql', 'utf8'));
    db.exec(`
      INSERT INTO distributor_spaces VALUES (1, 'owner', 1);
      INSERT INTO code_pools (id, space_id, name, claim_key, created_at)
      VALUES (1, 1, 'mixed', 'mixed', 1), (2, 1, 'empty', 'empty', 1);
      INSERT INTO redemption_codes (pool_id, code, status, claimed_at, redeemed_marked_at, created_at)
      VALUES (1, 'a', 'unclaimed', NULL, NULL, 1),
             (1, 'b', 'claimed', 2, NULL, 1),
             (1, 'c', 'redeemed', NULL, 3, 1),
             (1, 'd', 'redeemed', 2, 3, 1);
    `);
    const before = db.prepare('SELECT * FROM redemption_codes ORDER BY id').all();
    const migration = await readFile('drizzle/0002_pool_counters.sql', 'utf8');
    const rebuild = await readFile('scripts/sql/rebuild-counters.sql', 'utf8');
    assert.equal(migration.split('--> statement-breakpoint').at(-1).trim(), rebuild.trim());
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT * FROM redemption_codes ORDER BY id').all(), before);
    assert.deepEqual(
      db
        .prepare(
          'SELECT total_count, unclaimed_count, redeemed_count, claimed_total_count FROM code_pools ORDER BY id',
        )
        .all()
        .map(Object.values),
      [
        [4, 1, 2, 2],
        [0, 0, 0, 0],
      ],
    );
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all(), []);
    const snapshot = JSON.parse(await readFile('drizzle/meta/0002_snapshot.json', 'utf8'));
    const previous = JSON.parse(await readFile('drizzle/meta/0001_snapshot.json', 'utf8'));
    assert.equal(snapshot.prevId, previous.id);
    assert.deepEqual(
      db
        .prepare('PRAGMA table_info(code_pools)')
        .all()
        .map((c) => c.name),
      Object.keys(snapshot.tables.code_pools.columns),
    );
    for (const column of db
      .prepare('PRAGMA table_info(code_pools)')
      .all()
      .filter((c) => c.name.endsWith('_count'))) {
      assert.equal(column.notnull, 1);
      assert.equal(column.dflt_value, '0');
    }
    const check = await readFile('scripts/sql/check-counters.sql', 'utf8');
    assert.deepEqual(db.prepare(check).all(), []);
    db.exec('UPDATE code_pools SET total_count = 999 WHERE id = 1');
    assert.equal(db.prepare(check).all().length, 1);
    db.exec(rebuild);
    assert.deepEqual(db.prepare(check).all(), []);
    db.exec(rebuild);
    assert.deepEqual(db.prepare(check).all(), []);
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + rebuild).all();
    assert.equal(plan.filter((r) => r.detail.includes('MATERIALIZE counts')).length, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('all migrations initialize an empty database with zero counter defaults', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort())
      db.exec(await readFile(`drizzle/${file}`, 'utf8'));
    db.exec(
      "INSERT INTO distributor_spaces VALUES (1, 'key', 1); INSERT INTO code_pools (space_id, name, claim_key, created_at) VALUES (1, 'pool', 'key', 1)",
    );
    assert.deepEqual(
      Object.values(
        db
          .prepare(
            'SELECT total_count, unclaimed_count, redeemed_count, claimed_total_count FROM code_pools',
          )
          .get(),
      ),
      [0, 0, 0, 0],
    );
  } finally {
    db.close();
  }
});

test('order index migration preserves records and counters and matches its snapshot', async () => {
  const db = await initializedDatabase();
  try {
    db.exec(await readFile('drizzle/0001_export_cursor_index.sql', 'utf8'));
    db.exec(`
      INSERT INTO distributor_spaces VALUES (1, 'owner', 1);
      INSERT INTO code_pools (id, space_id, name, claim_key, created_at)
      VALUES (1, 1, 'mixed', 'mixed', 1), (2, 1, 'empty', 'empty', 1);
      INSERT INTO redemption_codes (pool_id, code, status, claimed_at, redeemed_marked_at, created_at)
      VALUES (1, 'a', 'unclaimed', NULL, NULL, 30),
             (1, 'b', 'claimed', 2, NULL, 10),
             (1, 'c', 'redeemed', NULL, 3, 10);
    `);
    db.exec(await readFile('drizzle/0002_pool_counters.sql', 'utf8'));
    const codes = db.prepare('SELECT * FROM redemption_codes ORDER BY id').all();
    const pools = db.prepare('SELECT * FROM code_pools ORDER BY id').all();
    db.exec(await readFile('drizzle/0003_code_order_indexes.sql', 'utf8'));
    assert.deepEqual(db.prepare('SELECT * FROM redemption_codes ORDER BY id').all(), codes);
    assert.deepEqual(db.prepare('SELECT * FROM code_pools ORDER BY id').all(), pools);
    const snapshot = JSON.parse(await readFile('drizzle/meta/0003_snapshot.json', 'utf8'));
    const previous = JSON.parse(await readFile('drizzle/meta/0002_snapshot.json', 'utf8'));
    assert.equal(snapshot.prevId, previous.id);
    const indexes = db.prepare('PRAGMA index_list(redemption_codes)').all();
    assert.deepEqual(
      indexes.map((index) => index.name).sort(),
      Object.keys(snapshot.tables.redemption_codes.indexes).sort(),
    );
    assert.ok(!indexes.some((index) => index.name === 'codes_pool_status_idx'));
    for (const index of indexes) {
      const definition = snapshot.tables.redemption_codes.indexes[index.name];
      assert.equal(Boolean(index.unique), definition.isUnique);
      assert.deepEqual(
        db
          .prepare(`PRAGMA index_info('${index.name}')`)
          .all()
          .map((column) => column.name),
        definition.columns,
      );
    }
    assert.deepEqual(
      db.prepare(await readFile('scripts/sql/check-counters.sql', 'utf8')).all(),
      [],
    );
  } finally {
    db.close();
  }
});

test('order indexes serve claim, every page filter and export without temporary sorting', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort())
      db.exec(await readFile(`drizzle/${file}`, 'utf8'));
    db.exec(`
      INSERT INTO distributor_spaces VALUES (1, 'owner', 1);
      INSERT INTO code_pools (id, space_id, name, claim_key, created_at)
      VALUES (1, 1, 'mixed', 'mixed', 1), (2, 1, 'other', 'other', 1);
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 5000)
      INSERT INTO redemption_codes (pool_id, code, status, claimed_at, redeemed_marked_at, created_at)
      SELECT 1, 'code-' || n,
        CASE n % 3 WHEN 0 THEN 'unclaimed' WHEN 1 THEN 'claimed' ELSE 'redeemed' END,
        CASE WHEN n % 3 = 1 THEN 100 END,
        CASE WHEN n % 3 = 2 THEN 100 END,
        n % 7 FROM numbers;
      INSERT INTO redemption_codes (pool_id, code, created_at) VALUES (2, 'other', 0);
    `);
    db.exec(await readFile('scripts/sql/rebuild-counters.sql', 'utf8'));
    const assertIndex = (query, index) => {
      const plan = db
        .prepare('EXPLAIN QUERY PLAN ' + query)
        .all()
        .map((r) => r.detail);
      assert.ok(
        plan.some((detail) => detail.includes(index)),
        plan.join('\n'),
      );
      assert.ok(
        plan.every((detail) => !detail.includes('TEMP B-TREE')),
        plan.join('\n'),
      );
    };
    assertIndex(
      `UPDATE redemption_codes SET status = 'claimed', claimed_at = 100, remark = NULL
       WHERE id = (SELECT r.id FROM redemption_codes r JOIN code_pools p ON p.id = r.pool_id
         WHERE p.id = 1 AND p.status = 'active' AND r.status = 'unclaimed'
         ORDER BY r.created_at, r.id LIMIT 1) AND status = 'unclaimed'
       RETURNING code, claimed_at AS claimedAt`,
      'codes_pool_status_created_id_idx',
    );
    for (const status of ['all', 'unclaimed', 'claimed', 'redeemed']) {
      const filter = status === 'all' ? '' : ` AND status = '${status}'`;
      assertIndex(
        `SELECT * FROM redemption_codes WHERE pool_id = 1${filter}
         ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 20`,
        status === 'all' ? 'codes_pool_created_id_idx' : 'codes_pool_status_created_id_idx',
      );
      assertIndex(
        `SELECT * FROM redemption_codes WHERE pool_id = 1${filter}
         AND id > 100 AND id <= 5000 ORDER BY id LIMIT 501`,
        'codes_pool_id_idx',
      );
    }
  } finally {
    db.close();
  }
});
