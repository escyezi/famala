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

test('one initialization creates the current schema without legacy tables or columns', async () => {
  assert.deepEqual(
    (await readdir('drizzle')).filter((name) => name.endsWith('.sql')),
    ['0000_initial.sql'],
  );
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
  assert.deepEqual(
    journal.entries.map(({ idx, tag }) => ({ idx, tag })),
    [{ idx: 0, tag: '0000_initial' }],
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
