export interface Bindings {
  DB: D1Database;
  ENVIRONMENT?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
}
export type AppEnv = {
  Bindings: Bindings;
  Variables: { spaceId: string; sessionId: string; expiresAt: number };
};
