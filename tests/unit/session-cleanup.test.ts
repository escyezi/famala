import { expect, test, vi } from 'vitest';
import { cleanupSQL, parseCleanupArguments, runSessionCleanup } from '../../scripts/sessions.ts';

test('cleanup requires an explicit target and caps the number of batches', () => {
  for (const args of [
    [],
    ['--local', '--remote'],
    ['--remote', '--batches=0'],
    ['--remote', '--batches=11'],
    ['--remote', '--batches=1', '--batches=2'],
    ['--local', '--other'],
  ])
    expect(() => parseCleanupArguments(args)).toThrow();
  expect(parseCleanupArguments(['--local'])).toEqual({ target: '--local', batches: 1 });
  expect(() => cleanupSQL(NaN)).toThrow();
});
test('cleanup freezes cutoff, stops on a partial batch, and reports possible remaining work', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const execute = vi
    .fn()
    .mockReturnValueOnce(JSON.stringify([{ success: true, meta: { changes: 1000 } }]))
    .mockReturnValue(JSON.stringify([{ success: true, meta: { changes: 3 } }]));
  expect(runSessionCleanup(['--local', '--batches=10'], execute, 100).deleted).toBe(1003);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0][1]).toEqual(execute.mock.calls[1][1]);
  execute.mockReturnValue(JSON.stringify([{ success: true, meta: { changes: 1000 } }]));
  expect(runSessionCleanup(['--remote', '--batches=2'], execute, 100)).toMatchObject({
    queries: 2,
    deleted: 2000,
    limitReached: true,
  });
  execute.mockReturnValue('[]');
  expect(() => runSessionCleanup(['--local'], execute)).toThrow();
});
