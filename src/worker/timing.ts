import { setStage } from './diagnostics.ts';
import type { DiagnosticStage } from './diagnostics.ts';
import type { Context } from 'hono';
import type { AppEnv } from './types.ts';

type Measure = <T>(name: DiagnosticStage, operation: () => Promise<T>) => Promise<T>;

export async function withServerTiming<T extends Response>(
  c: Context<AppEnv>,
  handler: (measure: Measure) => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const timings: string[] = [];
  let response: T | undefined;
  const measure: Measure = async (name, operation) => {
    setStage(c, name);
    const start = performance.now();
    try {
      return await operation();
    } finally {
      timings.push(`${name};dur=${(performance.now() - start).toFixed(2)}`);
    }
  };
  try {
    response = await handler(measure);
    return response;
  } finally {
    timings.push(`total;dur=${(performance.now() - started).toFixed(2)}`);
    if (response) response.headers.set('Server-Timing', timings.join(', '));
    else c.header('Server-Timing', timings.join(', '));
  }
}
