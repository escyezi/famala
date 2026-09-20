import { readdir, readFile } from 'node:fs/promises';

// Each API suite owns one ephemeral proxy. Migrations run once; tests run serially.
export async function migrate(db: D1Database) {
  for (const name of (await readdir('drizzle')).filter((n) => n.endsWith('.sql')).sort()) {
    const migration = await readFile(`drizzle/${name}`, 'utf8');
    const statements = migration
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
}
