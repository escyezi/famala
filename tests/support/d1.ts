import assert from 'node:assert/strict';

// Wrap the entire binding so authentication and ownership queries count too.
// afterWrite simulates a concurrent request immediately after an import commits.
export function measureD1(database: D1Database, afterWrite: () => Promise<void> = async () => {}) {
  let queries = 0;
  let maxParameters = 0;
  const executions: { query: string; meta?: D1Meta }[] = [];
  const statements = new WeakMap<
    D1PreparedStatement,
    { statement: D1PreparedStatement; query: string }
  >();
  const countQueries = (count: number) => {
    queries += count;
    assert.ok(queries <= 50, `D1 query budget exceeded: ${queries}`);
  };
  function wrap(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === 'bind')
          return (...params: unknown[]) => {
            maxParameters = Math.max(maxParameters, params.length);
            assert.ok(params.length <= 100, `D1 parameter limit exceeded: ${params.length}`);
            return wrap(target.bind(...params), query);
          };
        if (key === 'all' || key === 'raw' || key === 'first' || key === 'run')
          return async (...args: unknown[]) => {
            countQueries(1);
            // raw() omits meta; obtain rows and metrics with one execution.
            const result = await target.all<Record<string, unknown>>();
            executions.push({ query, meta: result.meta });
            if (/WITH incoming/.test(query)) await afterWrite();
            if (key === 'raw') {
              const rows = result.results.map((row) => Object.values(row));
              return (args[0] as { columnNames?: boolean } | undefined)?.columnNames
                ? [Object.keys(result.results[0] ?? {}), ...rows]
                : rows;
            }
            if (key === 'first')
              return args[0] === undefined
                ? (result.results[0] ?? null)
                : (result.results[0]?.[String(args[0])] ?? null);
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    statements.set(wrapped, { statement, query });
    return wrapped;
  }
  const db = new Proxy(database, {
    get(target, key) {
      if (key === 'prepare') return (query: string) => wrap(target.prepare(query), query);
      if (key === 'batch')
        return async (batch: D1PreparedStatement[]) => {
          countQueries(batch.length);
          const entries = batch.map((statement) => {
            const entry = statements.get(statement);
            assert.ok(entry, 'Batch must use statements from the measured binding');
            return entry;
          });
          const results = await target.batch(entries.map((entry) => entry.statement));
          results.forEach((result, i) =>
            executions.push({ query: entries[i].query, meta: result.meta }),
          );
          if (entries.some((entry) => /WITH incoming/.test(entry.query))) await afterWrite();
          return results;
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    db,
    stats: () => ({
      queries,
      maxParameters,
      rowsRead: executions.reduce((sum, r) => sum + (r.meta?.rows_read ?? 0), 0),
      rowsWritten: executions.reduce((sum, r) => sum + (r.meta?.rows_written ?? 0), 0),
      counterWrites: executions.filter(
        (r) => /^UPDATE code_pools SET/.test(r.query) && (r.meta?.changes ?? 0) > 0,
      ).length,
      executions,
    }),
  };
}
