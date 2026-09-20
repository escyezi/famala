import type { DiagnosticStage } from './diagnostics.ts';
// Bindings come from Wrangler. Text configuration can be absent at runtime;
// validators must still fail closed rather than assuming deployment configuration.
export type Bindings = Pick<Cloudflare.Env, 'DB'> & Partial<Omit<Cloudflare.Env, 'DB'>>;
export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    spaceId: number;
    sessionId: number;
    expiresAt: number;
    diagnostic: { requestId: string; startedAt: number; stage: DiagnosticStage };
  };
};
