import { MAX_DELETE_CODES, isCodeFilter, isCodePageSize } from '../shared/contracts.ts';
import type { CodeFilter, CodePageSize } from '../shared/contracts.ts';
import { errorBody } from '../shared/messages.ts';
import { ApiException, validationError } from './errors.ts';
import type { MiddlewareHandler } from 'hono';
import { validator } from 'hono/validator';
import {
  normalizeRemark,
  codePointLength,
  MAX_POOL_NAME_LENGTH,
  MAX_POOL_DESCRIPTION_LENGTH,
} from '../shared/contracts.ts';
import type { AppEnv } from './types.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiException(400, 'INVALID_JSON');
  return value as Record<string, unknown>;
}

function claimKey(value: unknown) {
  if (typeof value !== 'string' || !/^c_[A-Za-z0-9_-]{43}$/.test(value.trim()))
    throw new ApiException(404, 'INVALID_CLAIM_KEY');
  return value.trim();
}

export const loginInput = validator('json', (value: unknown, c) => {
  const { key } = object(value);
  if (typeof key !== 'string' || !/^d_[A-Za-z0-9_-]{43}$/.test(key.trim()))
    return c.json(errorBody('INVALID_DISTRIBUTOR_KEY'), 401);
  return { key: key.trim() };
});

export const poolNameInput = validator('json', (value: unknown, c) => {
  const { name, description } = object(value);
  if (typeof name !== 'string' || !name.trim()) return c.json(errorBody('POOL_NAME_REQUIRED'), 400);
  if (name.includes('\0')) return c.json(errorBody('POOL_NAME_NULL'), 400);
  if (
    description !== undefined &&
    description !== null &&
    (typeof description !== 'string' || description.includes('\0'))
  )
    return c.json(errorBody('INVALID_POOL_DESCRIPTION'), 400);
  if (codePointLength(name.trim()) > MAX_POOL_NAME_LENGTH)
    return c.json(errorBody('POOL_NAME_TOO_LONG', { limit: MAX_POOL_NAME_LENGTH }), 400);
  if (codePointLength(description?.trim() ?? '') > MAX_POOL_DESCRIPTION_LENGTH)
    return c.json(
      errorBody('POOL_DESCRIPTION_TOO_LONG', { limit: MAX_POOL_DESCRIPTION_LENGTH }),
      400,
    );
  return {
    name: name.trim(),
    ...(description === undefined ? {} : { description: description?.trim() || null }),
  };
});

export const poolStatusInput = validator('json', (value: unknown, c) => {
  const { status } = object(value);
  if (status !== 'active' && status !== 'stopped')
    return c.json(errorBody('INVALID_POOL_STATUS'), 400);
  return { status } as const;
});

export const importInput = validator('json', (value: unknown, c) => {
  const { text } = object(value);
  if (typeof text !== 'string') return c.json(errorBody('IMPORT_TEXT_REQUIRED'), 400);
  return { text };
});

export const deleteCodesInput = validator('json', (value: unknown, c) => {
  const { ids } = object(value);
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_DELETE_CODES ||
    !ids.every((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
  )
    return c.json(errorBody('INVALID_CODE_SELECTION'), 400);
  return { ids: [...new Set(ids)] };
});

export const claimKeyInput = validator('json', (value: unknown) => ({
  claimKey: claimKey(object(value).claimKey),
}));

export const claimInput = validator('json', (value: unknown, c) => {
  const data = object(value);
  const key = claimKey(data.claimKey);
  let remark;
  try {
    remark = normalizeRemark(data.remark);
  } catch (error) {
    return c.json(validationError(error), 400);
  }
  if (
    typeof data.turnstileToken !== 'string' ||
    !data.turnstileToken ||
    data.turnstileToken.length > 2048
  )
    return c.json(errorBody('TURNSTILE_FAILED'), 400);
  return {
    claimKey: key,
    ...(data.remark === undefined ? {} : { remark }),
    turnstileToken: data.turnstileToken,
  };
});

function exportInteger(values: string[] | undefined, fallback?: number) {
  if (!values && fallback !== undefined) return fallback;
  if (
    !values ||
    values.length !== 1 ||
    !/^(0|[1-9]\d*)$/.test(values[0]) ||
    !Number.isSafeInteger(Number(values[0]))
  )
    throw new ApiException(400, 'INVALID_EXPORT_QUERY');
  return Number(values[0]);
}

export const exportManifestQuery: MiddlewareHandler<
  AppEnv,
  string,
  {
    in: { query: { poolId?: string } };
    out: { query: { poolId?: number } };
  }
> = async (c, next) => {
  const values = c.req.queries('poolId');
  const poolId = values ? exportInteger(values) : undefined;
  if (poolId === 0) throw new ApiException(400, 'INVALID_EXPORT_QUERY');
  c.req.addValidatedData('query', { poolId });
  await next();
};

export const exportCodesQuery: MiddlewareHandler<
  AppEnv,
  string,
  {
    in: { query: { afterId?: string; maxId: string; status?: CodeFilter } };
    out: { query: { afterId: number; maxId: number; status: CodeFilter } };
  }
> = async (c, next) => {
  const query = c.req.queries();
  const afterId = exportInteger(query.afterId, 0);
  const maxId = exportInteger(query.maxId);
  const status = query.status?.[0] ?? 'all';
  if (afterId > maxId) throw new ApiException(400, 'INVALID_EXPORT_QUERY');
  if ((query.status && query.status.length !== 1) || !isCodeFilter(status))
    throw new ApiException(400, 'INVALID_FILTER');
  c.req.addValidatedData('query', { afterId, maxId, status: status as CodeFilter });
  await next();
};
// Hono's default query input allows arbitrary strings/arrays. Narrow the public
// RPC input to the values this validator actually accepts; keep parsed numbers
// on the server side only.
export const codesQuery: MiddlewareHandler<
  AppEnv,
  string,
  {
    in: { query: { page?: string; status?: CodeFilter; pageSize?: CodePageSize } };
    out: { query: { page: number; status: CodeFilter; pageSize: number } };
  }
> = async (c, next) => {
  const query = c.req.queries();
  const page = Number(query.page?.[0] ?? '1');
  if (
    (query.page && query.page.length !== 1) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1_000_000
  )
    throw new ApiException(400, 'INVALID_PAGE');
  const status = query.status?.[0] || 'all';
  if ((query.status && query.status.length !== 1) || !isCodeFilter(status))
    throw new ApiException(400, 'INVALID_FILTER');
  const size = query.pageSize?.[0] ?? '50';
  if ((query.pageSize && query.pageSize.length !== 1) || !isCodePageSize(size))
    throw new ApiException(400, 'INVALID_PAGE_SIZE');
  c.req.addValidatedData('query', { page, status, pageSize: Number(size) });
  await next();
};
