import { api, ApiError, rpc } from '../api.ts';
import type { CodeFilter } from '../../shared/api-types.ts';
import type {
  ExportCommand,
  ExportLabels,
  ExportProgress,
  ExportReply,
  ExportResult,
} from './types.ts';

function aborted() {
  return new DOMException('Export cancelled', 'AbortError');
}
function check(signal: AbortSignal) {
  if (signal.aborted) throw aborted();
}

async function delay(ms: number, signal: AbortSignal) {
  check(signal);
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function exportRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    check(signal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30_000);
    try {
      const data = await request(controller.signal);
      check(signal);
      return data;
    } catch (error) {
      check(signal);
      const temporary =
        timedOut ||
        (error instanceof ApiError &&
          (error.status === 0 || [500, 502, 503, 504].includes(error.status)));
      if (!temporary || attempt >= 2) throw timedOut ? new ApiError('NETWORK_ERROR', 0) : error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
    await delay(500 * 2 ** attempt, signal);
  }
}

// Acknowledgements provide backpressure: there is only one batch in flight.
function workerClient(worker: Worker, signal: AbortSignal) {
  let sequence = 0;
  let pending:
    | { id: number; resolve: (result?: ExportResult) => void; reject: (error: Error) => void }
    | undefined;
  let failed = false;
  const fail = () => {
    failed = true;
    pending?.reject(new ApiError('EXPORT_FAILED', 0));
    pending = undefined;
  };
  const abort = () => {
    worker.terminate();
    pending?.reject(aborted());
    pending = undefined;
  };
  worker.onmessage = (event: MessageEvent<ExportReply>) => {
    if (event.data.id !== pending?.id) return;
    if (event.data.error) fail();
    else {
      pending?.resolve(event.data.result);
      pending = undefined;
    }
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  signal.addEventListener('abort', abort, { once: true });
  return {
    send(command: ExportCommand) {
      check(signal);
      if (failed || pending) throw new ApiError('EXPORT_FAILED', 0);
      return new Promise<ExportResult | undefined>((resolve, reject) => {
        pending = { id: ++sequence, resolve, reject };
        try {
          worker.postMessage({ id: sequence, command });
        } catch {
          fail();
        }
      });
    },
    close() {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    },
  };
}

export async function runExport({
  poolId,
  status,
  labels,
  signal,
  onProgress,
}: {
  poolId?: number;
  status: CodeFilter;
  labels: ExportLabels;
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
}): Promise<ExportResult> {
  const manifest = await exportRequest(
    (signal) =>
      api(
        rpc.api.manage.exports.manifest.$get(
          {
            query: poolId === undefined ? {} : { poolId: String(poolId) },
          },
          { init: { signal } },
        ),
      ),
    signal,
  );
  if (!manifest.pools.length) throw new ApiError('EXPORT_EMPTY', 0);
  check(signal);
  const client = workerClient(
    new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' }),
    signal,
  );
  let rows = 0;
  let completed = 0;
  const report = (stage: ExportProgress['stage']) => {
    check(signal);
    onProgress({ stage, rows, completed, total: manifest.pools.length });
  };
  try {
    await client.send({
      type: 'init',
      options: {
        status,
        labels,
        startedAt: manifest.startedAt,
        allPools: poolId === undefined,
      },
    });
    for (const pool of manifest.pools) {
      report('reading');
      await client.send({ type: 'pool', pool });
      let afterId = 0;
      for (;;) {
        const page = await exportRequest(
          (signal) =>
            api(
              rpc.api.manage.pools[':id'].codes.export.$get(
                {
                  param: { id: String(pool.id) },
                  query: { afterId: String(afterId), maxId: String(pool.maxId), status },
                },
                { init: { signal } },
              ),
            ),
          signal,
        );
        if (
          page.nextCursor !== null &&
          (page.nextCursor <= afterId || page.nextCursor > pool.maxId)
        )
          throw new ApiError('INVALID_RESPONSE', 500);
        await client.send({ type: 'rows', rows: page.items });
        rows += page.items.length;
        report('reading');
        if (page.nextCursor === null) break;
        afterId = page.nextCursor;
      }
      report('generating');
      await client.send({ type: 'endPool', endedAt: Date.now() });
      completed++;
    }
    report(poolId === undefined ? 'packing' : 'generating');
    const result = await client.send({ type: 'finish', endedAt: Date.now() });
    if (!result) throw new ApiError('EXPORT_FAILED', 0);
    report('done');
    return result;
  } finally {
    client.close();
  }
}
