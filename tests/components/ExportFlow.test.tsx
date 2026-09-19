import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../src/react-app/api.ts';
import { runExport, exportRequest } from '../../src/react-app/export/run-export.ts';
import { zh } from '../../src/react-app/i18n/zh-CN.ts';
import type { ExportCommand, ExportReply } from '../../src/react-app/export/types.ts';
import { json } from './helpers.ts';

class FakeWorker {
  static instances: FakeWorker[] = [];
  commands: ExportCommand[] = [];
  terminate = vi.fn();
  onmessage?: (event: MessageEvent<ExportReply>) => void;
  onerror?: () => void;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage({ id, command }: { id: number; command: ExportCommand }) {
    this.commands.push(command);
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          id,
          ...(command.type === 'finish'
            ? { result: { blob: new Blob(['ok']), filename: 'export.zip' } }
            : {}),
        },
      } as MessageEvent<ExportReply>),
    );
  }
}
afterEach(() => {
  vi.useRealTimers();
  FakeWorker.instances = [];
});
const row = (id: number) => ({
  id,
  code: `C${id}`,
  status: 'unclaimed',
  createdAt: 1,
  claimedAt: null,
  redeemedMarkedAt: null,
  remark: null,
});
const options = () => ({
  status: 'all' as const,
  labels: zh.exports,
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

test('serial export respects manifest bounds, next cursors, empty pools and acknowledgements', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      paths.push(url.pathname + url.search);
      if (url.pathname.endsWith('manifest'))
        return json({
          startedAt: 1,
          pools: [
            { id: 1, name: 'one', maxId: 501 },
            { id: 2, name: 'empty', maxId: 0 },
          ],
        });
      if (url.pathname.includes('/2/')) return json({ items: [], nextCursor: null });
      if (url.searchParams.get('afterId') === '0')
        return json({ items: Array.from({ length: 500 }, (_, i) => row(i + 1)), nextCursor: 500 });
      return json({ items: [row(501)], nextCursor: null });
    }),
  );
  const opts = options();
  const result = await runExport(opts);
  expect(result.filename).toBe('export.zip');
  expect(paths).toEqual([
    '/api/manage/exports/manifest',
    '/api/manage/pools/1/codes/export?afterId=0&maxId=501&status=all',
    '/api/manage/pools/1/codes/export?afterId=500&maxId=501&status=all',
    '/api/manage/pools/2/codes/export?afterId=0&maxId=0&status=all',
  ]);
  const worker = FakeWorker.instances[0];
  expect(worker.commands.map((c) => c.type)).toEqual([
    'init',
    'pool',
    'rows',
    'rows',
    'endPool',
    'pool',
    'rows',
    'endPool',
    'finish',
  ]);
  expect(worker.terminate).toHaveBeenCalled();
  expect(opts.onProgress).toHaveBeenLastCalledWith({
    stage: 'done',
    rows: 501,
    completed: 2,
    total: 2,
  });
});

test('deleted pool rejects the whole export and never finishes a partial archive', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('manifest')
        ? json({ startedAt: 1, pools: [{ id: 1, name: 'gone', maxId: 1 }] })
        : json({ code: 'POOL_NOT_FOUND' }, 404),
    ),
  );
  await expect(runExport(options())).rejects.toMatchObject({ code: 'POOL_NOT_FOUND' });
  expect(FakeWorker.instances[0].commands.some((c) => c.type === 'finish')).toBe(false);
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
});

test('empty workspace does not start a worker', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ startedAt: 1, pools: [] })),
  );
  await expect(runExport(options())).rejects.toMatchObject({ code: 'EXPORT_EMPTY' });
  expect(FakeWorker.instances).toHaveLength(0);
});

test('temporary failures retry at most twice; authorization failures do not retry', async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockRejectedValue(new ApiError('SERVICE_UNAVAILABLE', 503));
  const promise = exportRequest(request, new AbortController().signal);
  const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
  await vi.runAllTimersAsync();
  await assertion;
  expect(request).toHaveBeenCalledTimes(3);
  const denied = vi.fn().mockRejectedValue(new ApiError('UNAUTHORIZED', 401));
  await expect(exportRequest(denied, new AbortController().signal)).rejects.toMatchObject({
    status: 401,
  });
  expect(denied).toHaveBeenCalledTimes(1);
});

test('cancellation aborts a pending fetch and prevents retries', async () => {
  const controller = new AbortController();
  const request = vi.fn(
    (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
  const promise = exportRequest(request, controller.signal);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(request).toHaveBeenCalledTimes(1);
});

test('401 uses existing session-expiry notification', async () => {
  const listener = vi.fn();
  window.addEventListener('famala:unauthorized', listener);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ code: 'UNAUTHORIZED' }, 401)),
  );
  await expect(runExport(options())).rejects.toMatchObject({ status: 401 });
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener('famala:unauthorized', listener);
});

test('worker startup failures reject promptly and terminate the worker', async () => {
  class BrokenWorker extends FakeWorker {
    postMessage() {
      queueMicrotask(() => this.onerror?.());
    }
  }
  vi.stubGlobal('Worker', BrokenWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ startedAt: 1, pools: [{ id: 1, name: 'one', maxId: 0 }] })),
  );
  await expect(runExport(options())).rejects.toMatchObject({ code: 'EXPORT_FAILED' });
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
});

test('request timeouts abort each attempt and stop after two retries', async () => {
  vi.useFakeTimers();
  const request = vi.fn(
    (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
  const assertion = expect(
    exportRequest(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  await vi.runAllTimersAsync();
  await assertion;
  expect(request).toHaveBeenCalledTimes(3);
});
