import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { env } from '../support/api-environment.ts';
import {
  claim,
  deleted,
  imported,
  markRedeemed,
  pool,
  request,
  space,
} from '../support/api-fixtures.mjs';

test('deleting a pool removes all its codes, invalidates sharing, and preserves other pools', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  const other = await pool(owner.cookie);
  await imported(p, owner.cookie, 'DELETE-CLAIMED\nDELETE-UNCLAIMED');
  await imported(other, owner.cookie, 'KEEP');
  const claimed = await claim(p);
  assert.equal(claimed.status, 200);
  assert.deepEqual((await deleted(p, owner.cookie)).body, { ok: true });
  assert.equal(
    (
      await env.DB.prepare('SELECT count(*) AS total FROM redemption_codes WHERE pool_id = ?')
        .bind(p.id)
        .first()
    ).total,
    0,
  );
  assert.deepEqual(
    (await request('/api/manage/pools', undefined, owner.cookie)).body.items.map((item) => item.id),
    [other.id],
  );
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).status,
    404,
  );
  assert.equal((await request('/api/claim/validate', { claimKey: p.claimKey })).status, 404);
  assert.equal((await claim(p)).status, 404);
  assert.equal((await deleted(p, owner.cookie)).status, 404);
  assert.equal((await claim(other)).body.code, 'KEEP');
  const replacement = await pool(owner.cookie, p.name);
  assert.ok(replacement.id > p.id);
  assert.notEqual(replacement.claimKey, p.claimKey);
  assert.equal((await deleted(replacement, owner.cookie)).status, 200);
  assert.deepEqual((await env.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('deletion enforces sessions, ownership, valid IDs and same-origin JSON requests', async () => {
  const owner = await space();
  const outsider = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'PROTECTED');
  assert.equal((await deleted(p)).status, 401);
  assert.equal((await deleted(p, outsider.cookie)).status, 404);
  for (const id of ['0', '-1', '1e0', `${p.id}oops`, '9007199254740992']) {
    assert.equal((await deleted({ id }, owner.cookie)).status, 404);
  }
  for (const [headers, status] of [
    [{ Origin: 'https://evil.example' }, 403],
    [{ 'Content-Type': 'text/plain' }, 415],
  ]) {
    assert.equal(
      (await request(`/api/manage/pools/${p.id}`, {}, owner.cookie, env, headers, 'DELETE')).status,
      status,
    );
  }
  assert.equal((await claim(p)).body.code, 'PROTECTED');
});

test('failed parent deletion rolls back deletion of all codes', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  await imported(p, owner.cookie, 'ROLLBACK');
  await env.DB.prepare(
    "CREATE TRIGGER reject_test_delete BEFORE DELETE ON code_pools BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  ).run();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    assert.equal((await deleted(p, owner.cookie)).status, 500);
    assert.equal(
      (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body.items[0]
        .code,
      'ROLLBACK',
    );
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_test_delete').run();
    log.mockRestore();
  }
  assert.equal((await claim(p)).body.code, 'ROLLBACK');
});

test('pool paths reject malformed and unsafe integer IDs without aliasing another pool', async () => {
  const owner = await space();
  const p = await pool(owner.cookie);
  for (const id of [
    '0',
    '-1',
    `0${p.id}`,
    `${p.id}.0`,
    `${p.id}e0`,
    `${p.id}x`,
    `+${p.id}`,
    '9007199254740992',
    crypto.randomUUID(),
  ]) {
    const result = await request(`/api/manage/pools/${id}/codes`, undefined, owner.cookie);
    assert.equal(result.status, 404, id);
  }
  assert.equal(
    (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).status,
    200,
  );
});

test('renaming preserves claims and sharing keys; duplicate and concurrent names remain unique', async () => {
  const owner = await space();
  const p = await pool(owner.cookie, '原名称');
  const other = await pool(owner.cookie, '已占用名称');
  await imported(p, owner.cookie, 'RENAME-1\nRENAME-2');
  const record = await claim(p);
  await markRedeemed(p, owner.cookie, record.body.code);
  await request(`/api/manage/pools/${p.id}/status`, { status: 'stopped' }, owner.cookie);
  const before = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  const rename = (id, name) => request(`/api/manage/pools/${id}/name`, { name }, owner.cookie);
  assert.equal((await rename(p.id, '  ')).status, 400);
  assert.equal((await rename(p.id, other.name)).status, 409);
  assert.equal((await rename(p.id, p.name)).status, 200);
  const result = await rename(p.id, '  新名称  ');
  assert.deepEqual(result.body, { id: p.id, name: '新名称' });
  const validation = await request('/api/claim/validate', { claimKey: p.claimKey });
  assert.deepEqual(validation.body, {
    name: '新名称',
    description: null,
    status: 'stopped',
    remaining: 1,
  });
  const after = (await request(`/api/manage/pools/${p.id}/codes`, undefined, owner.cookie)).body;
  assert.deepEqual(after, before);
  const updated = (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
    (item) => item.id === p.id,
  );
  assert.equal(updated.claimKey, p.claimKey);
  assert.equal(updated.createdAt, p.createdAt);
  const races = await Promise.all([rename(p.id, '同一个名字'), rename(other.id, '同一个名字')]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
});

test('pool descriptions are optional, editable, public, and protected with the pool', async () => {
  const owner = await space();
  const outsider = await space();
  const created = await request(
    '/api/manage/pools',
    {
      name: '说明测试',
      description: '  第一行\n第二行 😀  ',
    },
    owner.cookie,
  );
  assert.equal(created.status, 201);
  const readPool = async () =>
    (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
      (item) => item.id === created.body.id,
    );
  const p = await readPool();
  assert.equal(p.description, '第一行\n第二行 😀');
  const readDescription = async () =>
    (await request('/api/claim/validate', { claimKey: p.claimKey })).body.description;
  assert.equal(await readDescription(), p.description);
  const path = `/api/manage/pools/${p.id}/name`;
  assert.equal(
    (await request(path, { name: p.name, description: '篡改' }, outsider.cookie)).status,
    404,
  );
  assert.equal((await request(path, { name: p.name, description: '篡改' })).status, 401);
  assert.equal(await readDescription(), p.description);
  await request(path, { name: '改名' }, owner.cookie);
  assert.equal(await readDescription(), p.description);
  for (const description of [42, {}, ['text'], 'bad\0text']) {
    assert.equal((await request(path, { name: '改名', description }, owner.cookie)).status, 400);
    assert.equal(
      (await request('/api/manage/pools', { name: '无效说明', description }, owner.cookie)).status,
      400,
    );
  }
  const other = await pool(owner.cookie);
  assert.equal(other.description, null);
  assert.equal(
    (await request(path, { name: other.name, description: '不应保存' }, owner.cookie)).status,
    409,
  );
  assert.equal(await readDescription(), p.description);
  await request(path, { name: '改名', description: '更新说明' }, owner.cookie);
  assert.equal(await readDescription(), '更新说明');
  for (const description of [' \n ', null]) {
    await request(path, { name: '改名', description }, owner.cookie);
    assert.equal(await readDescription(), null);
    assert.equal((await readPool()).description, null);
  }
  assert.equal((await readPool()).claimKey, p.claimKey);
});

test('pool names and descriptions enforce trimmed Unicode limits on create and edit', async () => {
  const owner = await space();
  for (const char of ['A', '池', '😀']) {
    const name = char.repeat(50);
    const description = char.repeat(500);
    const created = await request(
      '/api/manage/pools',
      { name: `  ${name}  `, description: `\n${description}\n` },
      owner.cookie,
    );
    assert.equal(created.status, 201);
    const path = `/api/manage/pools/${created.body.id}/name`;
    for (const endpoint of ['/api/manage/pools', path]) {
      for (const [data, code, limit] of [
        [{ name: name + char, description }, 'POOL_NAME_TOO_LONG', 50],
        [{ name, description: description + char }, 'POOL_DESCRIPTION_TOO_LONG', 500],
      ]) {
        const result = await request(endpoint, data, owner.cookie);
        assert.equal(result.status, 400);
        assert.deepEqual(result.body, { code, params: { limit } });
      }
    }
    const readPool = async () =>
      (await request('/api/manage/pools', undefined, owner.cookie)).body.items.find(
        (item) => item.id === created.body.id,
      );
    assert.equal((await readPool()).name, name);
    assert.equal((await readPool()).description, description);
    const updated = await request(
      path,
      { name: ` ${name} `, description: ` ${description} ` },
      owner.cookie,
    );
    assert.equal(updated.status, 200);
    assert.equal((await readPool()).description, description);
  }
});

test('workspace pool limit is atomic, includes stopped pools and frees capacity after deletion', async () => {
  const owner = await space();
  await env.DB.prepare(
    `
    WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 49)
    INSERT INTO code_pools (space_id, name, claim_key, status, created_at)
    SELECT ?, 'seed-' || n, ? || n, 'stopped', 1 FROM numbers
  `,
  )
    .bind(owner.body.spaceId, crypto.randomUUID())
    .run();
  const attempts = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      request('/api/manage/pools', { name: `new-${i}` }, owner.cookie),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === 201).length, 1);
  for (const response of attempts.filter((r) => r.status !== 201)) {
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { code: 'SPACE_POOL_LIMIT', params: { limit: 50 } });
  }
  assert.equal((await request('/api/manage/pools', undefined, owner.cookie)).body.items.length, 50);
  assert.equal(
    (await request('/api/manage/pools', { name: 'seed-1' }, owner.cookie)).body.code,
    'POOL_NAME_EXISTS',
  );
  const outsider = await space();
  await pool(outsider.cookie, 'seed-1');
  const created = attempts.find((r) => r.status === 201);
  assert.equal((await deleted({ id: created.body.id }, owner.cookie)).status, 200);
  await pool(owner.cookie, 'replacement');
  assert.equal(
    (await request('/api/manage/pools', { name: 'overflow' }, owner.cookie)).body.code,
    'SPACE_POOL_LIMIT',
  );
});
