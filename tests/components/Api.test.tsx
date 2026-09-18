import type { ApiResponses } from './helpers.ts';
import { expect, test } from 'vitest';
import { api, ApiError, rpc } from '../../src/react-app/api.ts';
import { json, mockApi, session } from './helpers.ts';

test('请求携带 Cookie、禁用缓存，无请求体的 POST 仍声明 JSON', async () => {
  const fetch = mockApi({
    'POST /api/spaces': () =>
      json({ key: 'new-key', ...session } satisfies ApiResponses['createSpace'], 201),
  });
  await api(rpc.api.spaces.$post());
  expect(fetch.mock.calls[0][1]).toMatchObject({
    credentials: 'same-origin',
    cache: 'no-store',
  });
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Content-Type')).toBe('application/json');
});

test('路由和非 JSON 错误响应均转为结构化 ApiError', async () => {
  mockApi({
    'POST /api/claim': () => json({ code: 'POOL_STOPPED' }, 409),
    'GET /api/config': () => new Response('<html>proxy failed</html>', { status: 502 }),
  });
  await expect(
    api(rpc.api.claim.$post({ json: { claimKey: 'key', turnstileToken: 'token' } })),
  ).rejects.toMatchObject({ message: 'POOL_STOPPED', status: 409, code: 'POOL_STOPPED' });
  await expect(api(rpc.api.config.$get())).rejects.toMatchObject({
    code: 'REQUEST_FAILED',
    status: 502,
  });
});

test.each([
  [
    'invalid JSON',
    () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
  ],
  ['HTML', () => new Response('<html>fallback</html>')],
  ['null', () => json(null)],
])('异常成功响应 %s 返回 INVALID_RESPONSE', async (_name, response) => {
  mockApi({ 'GET /api/config': response });
  await expect(api(rpc.api.config.$get())).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
    status: 500,
  });
});

test('取消信号原样传递，AbortError 不被改成网络错误', async () => {
  const aborted = new DOMException('Aborted', 'AbortError');
  const fetch = mockApi({
    'GET /api/config': () => {
      throw aborted;
    },
  });
  const controller = new AbortController();
  await expect(
    api(rpc.api.config.$get(undefined, { init: { signal: controller.signal } })),
  ).rejects.toBe(aborted);
  expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal);
});

test('普通网络错误返回 NETWORK_ERROR', async () => {
  mockApi({
    'GET /api/config': () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await expect(api(rpc.api.config.$get())).rejects.toMatchObject({
    status: 0,
    code: 'NETWORK_ERROR',
  });
});

test('领取网络错误保留独立的 CLAIM_NETWORK_ERROR', async () => {
  mockApi({
    'POST /api/claim': () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await expect(
    api(rpc.api.claim.$post({ json: { claimKey: 'key', turnstileToken: 'token' } })),
  ).rejects.toMatchObject({ status: 0, code: 'CLAIM_NETWORK_ERROR' });
});

test.each([
  [{ code: 'UNKNOWN_CODE', error: 'untrusted text' }, 'UNKNOWN_CODE'],
  [{ error: 'untrusted text' }, 'REQUEST_FAILED'],
  [{ code: 42 }, 'REQUEST_FAILED'],
])('错误响应 %j 不使用服务端展示文本', async (body, code) => {
  mockApi({ 'GET /api/config': () => json(body, 500) });
  await expect(api(rpc.api.config.$get())).rejects.toMatchObject({
    status: 500,
    code,
    message: code,
  });
});

test('错误参数保留有效的文本和数字，忽略对象参数', async () => {
  mockApi({
    'GET /api/config': () =>
      json(
        {
          code: 'DUPLICATE_IN_BATCH',
          params: {
            firstLine: 3,
            label: 'example',
            invalid: { nested: true },
            list: [],
            missing: null,
          },
        },
        400,
      ),
  });
  const error: unknown = await api(rpc.api.config.$get()).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 400, code: 'DUPLICATE_IN_BATCH' });
  expect((error as ApiError).params).toEqual({ firstLine: 3, label: 'example' });
});
