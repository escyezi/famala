import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { parseArguments, runCounters } from '../scripts/counters.mjs';
import maintenance from '../src/worker/maintenance.ts';

test('counter maintenance requires an explicit target and rebuild requires paused writers', () => {
  for (const args of [
    [],
    ['check'],
    ['check', '--local', '--remote'],
    ['rebuild', '--remote'],
    ['check', '--wrong'],
  ])
    assert.throws(() => parseArguments(args), /Usage:/);
  assert.deepEqual(parseArguments(['check', '--local']), { operation: 'check', target: '--local' });
  assert.deepEqual(parseArguments(['rebuild', '--remote', '--writes-paused']), {
    operation: 'rebuild',
    target: '--remote',
  });
});

test('rebuild runs the repair followed by a failing-or-passing validation', () => {
  const calls = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const execute = (binary, args) => {
    calls.push({ binary, args });
    return JSON.stringify([{ success: true, results: [] }]);
  };
  runCounters(['rebuild', '--local', '--writes-paused'], execute);
  assert.equal(calls.length, 2);
  assert.match(calls[0].args[calls[0].args.indexOf('--command') + 1], /UPDATE code_pools/);
  assert.match(calls[1].args[calls[1].args.indexOf('--command') + 1], /expected_total_count/);
  assert.ok(calls.every((c) => !c.args.includes('--file')));
  assert.ok(calls.every((c) => c.args.includes('--local') && !c.args.includes('--remote')));
  assert.ok(calls.every((c) => c.args.includes('--config')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  assert.throws(
    () =>
      runCounters(['check', '--remote'], () =>
        JSON.stringify([{ success: true, results: [{ id: 1 }] }]),
      ),
    /Counter mismatch/,
  );
  assert.throws(
    () =>
      runCounters(['check', '--local'], () => JSON.stringify([{ success: false, results: [] }])),
    /unsuccessful/,
  );
  assert.throws(() => runCounters(['check', '--local'], () => '[]'), /invalid/);
});

test('maintenance responds 503 without needing database bindings or an installed schema', async () => {
  for (const method of ['GET', 'POST', 'DELETE', 'OPTIONS']) {
    const result = maintenance.fetch(new Request('https://famala.example/api/config', { method }));
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.headers.get('Retry-After'), '60');
    assert.deepEqual(await result.json(), { code: 'SERVICE_UNAVAILABLE' });
  }
});
