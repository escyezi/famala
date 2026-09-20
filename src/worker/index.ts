import { diagnostics, logFailure } from './diagnostics.ts';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { errorBody } from '../shared/messages.ts';
import { requireSession } from './auth.ts';
import { ApiException } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { claimsRoutes } from './routes/claims.ts';
import { codesRoutes } from './routes/codes.ts';
import { exportsRoutes } from './routes/exports.ts';
import { poolsRoutes } from './routes/pools.ts';
import type { AppEnv } from './types.ts';

const app = new Hono<AppEnv>();
app.use('/api/*', diagnostics);
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (
      (origin && origin !== new URL(c.req.url).origin) ||
      c.req.header('Sec-Fetch-Site') === 'cross-site'
    )
      return c.json(errorBody('CROSS_SITE_REQUEST'), 403);
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? ''))
      return c.json(errorBody('JSON_REQUIRED'), 415);
  }
  await next();
});
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json(errorBody('BODY_TOO_LARGE'), 413),
  }),
);

const routes = app
  .use('/api/manage/*', requireSession)
  .route('/', authRoutes)
  .route('/', poolsRoutes)
  .route('/', codesRoutes)
  .route('/', claimsRoutes)
  .route('/', exportsRoutes);
app.notFound((c) => c.json(errorBody('NOT_FOUND'), 404));
app.onError((error, c) => {
  if (error instanceof ApiException)
    return c.json(errorBody(error.code, error.params), error.status);
  if (error instanceof HTTPException)
    return c.json(
      errorBody(error.status === 400 ? 'INVALID_JSON' : 'REQUEST_FAILED'),
      error.status,
    );
  // Database errors may contain bound secrets or codes: don't log their payloads.
  logFailure(c, error);
  return c.json(errorBody('SERVICE_UNAVAILABLE'), 500);
});
export type AppType = typeof routes;
export default routes;
