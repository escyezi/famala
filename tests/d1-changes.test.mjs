import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { getPlatformProxy } from 'wrangler';

let proxy;
let db;
beforeAll(async () => {
  proxy = await getPlatformProxy({ persist: false });
  db = proxy.env.DB;
  await db.batch([
    db.prepare('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT UNIQUE)'),
    db.prepare('CREATE TABLE totals (id INTEGER PRIMARY KEY, count INTEGER CHECK (count >= 0))'),
    db.prepare('INSERT INTO totals VALUES (1, 0)'),
  ]);
});
afterAll(async () => await proxy?.dispose());
beforeEach(async () => {
  await db.batch([db.prepare('DELETE FROM items'), db.prepare('UPDATE totals SET count = 0')]);
});

test('D1 batch changes() counts actual writes with RETURNING, conflicts and zero changes', async () => {
  const update = () =>
    db.prepare('UPDATE totals SET count = count + changes() WHERE id = 1 AND changes() > 0');
  const results = await db.batch([
    db.prepare("INSERT INTO items (value) VALUES ('a'), ('b') RETURNING id"),
    update(),
    db.prepare("INSERT INTO items (value) VALUES ('b'), ('c') ON CONFLICT DO NOTHING RETURNING id"),
    update(),
    db.prepare("INSERT INTO items (value) VALUES ('c') ON CONFLICT DO NOTHING RETURNING id"),
    update(),
  ]);
  assert.deepEqual(
    results.filter((_, i) => i % 2 === 0).map((r) => r.results.length),
    [2, 1, 0],
  );
  assert.equal(await db.prepare('SELECT count FROM totals').first('count'), 3);
  assert.equal(results[5].meta.changes, 0);
  await db.batch([
    db.prepare("DELETE FROM items WHERE value IN ('a', 'b') RETURNING id"),
    db.prepare('UPDATE totals SET count = count - changes() WHERE id = 1 AND changes() > 0'),
  ]);
  assert.equal(await db.prepare('SELECT count FROM totals').first('count'), 1);
});

test('D1 rolls back a returned write when the following counter update fails', async () => {
  await assert.rejects(() =>
    db.batch([
      db.prepare("INSERT INTO items (value) VALUES ('rollback') RETURNING id"),
      db.prepare('UPDATE totals SET count = -changes() WHERE id = 1'),
    ]),
  );
  assert.equal(
    await db.prepare("SELECT count(*) AS n FROM items WHERE value = 'rollback'").first('n'),
    0,
  );
  assert.equal(await db.prepare('SELECT count FROM totals').first('count'), 0);
});
