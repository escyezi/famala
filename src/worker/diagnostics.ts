import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './types.ts';

// Never derive log fields from arbitrary paths, headers, exception messages or SQL.
const operations = [
  ['GET', /^\/api\/config$/, 'config'],
  ['POST', /^\/api\/spaces$/, 'space_create'],
  ['POST', /^\/api\/login$/, 'login'],
  ['GET', /^\/api\/manage\/session$/, 'session_read'],
  ['POST', /^\/api\/manage\/logout$/, 'logout'],
  ['GET', /^\/api\/manage\/exports\/manifest$/, 'export_manifest'],
  ['GET', /^\/api\/manage\/pools\/[^/]+\/codes\/export$/, 'export_codes'],
  ['GET', /^\/api\/manage\/pools$/, 'pool_list'],
  ['POST', /^\/api\/manage\/pools$/, 'pool_create'],
  ['DELETE', /^\/api\/manage\/pools\/[^/]+$/, 'pool_delete'],
  ['POST', /^\/api\/manage\/pools\/[^/]+\/name$/, 'pool_rename'],
  ['POST', /^\/api\/manage\/pools\/[^/]+\/status$/, 'pool_status'],
  ['POST', /^\/api\/manage\/pools\/[^/]+\/import$/, 'codes_import'],
  ['POST', /^\/api\/manage\/pools\/[^/]+\/redeemed\/import$/, 'redeemed_import'],
  ['GET', /^\/api\/manage\/pools\/[^/]+\/codes$/, 'codes_list'],
  ['DELETE', /^\/api\/manage\/pools\/[^/]+\/codes$/, 'codes_delete'],
  ['DELETE', /^\/api\/manage\/pools\/[^/]+\/codes\/[^/]+$/, 'code_delete'],
  ['POST', /^\/api\/claim\/validate$/, 'claim_validate'],
  ['POST', /^\/api\/claim$/, 'claim'],
] as const;
export type DiagnosticStage =
  | 'request'
  | 'session'
  | 'ownership'
  | 'operation'
  | 'pool_lookup'
  | 'turnstile'
  | 'code_allocate'
  | 'pool_recheck';
export const diagnostics: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('diagnostic', { requestId, startedAt: performance.now(), stage: 'request' });
  c.header('X-Request-ID', requestId);
  await next();
};
export function setStage(c: Context<AppEnv>, stage: DiagnosticStage) {
  const diagnostic = c.get('diagnostic');
  if (diagnostic) diagnostic.stage = stage;
}
export function logFailure(c: Context<AppEnv>, error: unknown) {
  const diagnostic = c.get('diagnostic');
  console.error(
    JSON.stringify({
      event: 'request_failed',
      operation:
        operations.find(
          ([method, path]) => method === c.req.method && path.test(c.req.path),
        )?.[2] ?? 'unknown',
      category: error instanceof TypeError ? 'runtime' : 'dependency_or_internal',
      stage: diagnostic?.stage ?? 'request',
      requestId: diagnostic?.requestId ?? crypto.randomUUID(),
      durationMs: Math.max(
        0,
        Math.round(performance.now() - (diagnostic?.startedAt ?? performance.now())),
      ),
    }),
  );
}
