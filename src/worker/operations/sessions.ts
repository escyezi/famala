import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { digest, randomKey, SESSION_MS } from '../auth.ts';
import { distributorSessions, distributorSpaces } from '../db/schema.ts';

export async function createSpace(database: D1Database) {
  const db = drizzle(database);
  const key = randomKey('d_');
  const token = randomKey('s_');
  const keyHash = await digest(key);
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  // Resolve the generated ID by its unique key hash inside the same transaction.
  // If session creation fails, the space insert is rolled back as well.
  const [spaces] = await db.batch([
    db
      .insert(distributorSpaces)
      .values({ keyHash, createdAt: now })
      .returning({ id: distributorSpaces.id }),
    db.insert(distributorSessions).values({
      spaceId: sql`(SELECT ${distributorSpaces.id} FROM ${distributorSpaces} WHERE ${distributorSpaces.keyHash} = ${keyHash})`,
      tokenHash: await digest(token),
      createdAt: now,
      expiresAt,
    }),
  ]);
  return { key, token, spaceId: spaces[0].id, expiresAt };
}

export async function loginSession(database: D1Database, key: string) {
  const db = drizzle(database);
  const space = await db
    .select({ id: distributorSpaces.id })
    .from(distributorSpaces)
    .where(eq(distributorSpaces.keyHash, await digest(key.trim())))
    .get();
  if (!space) return null;
  const token = randomKey('s_');
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  await db.insert(distributorSessions).values({
    spaceId: space.id,
    tokenHash: await digest(token),
    createdAt: now,
    expiresAt,
  });
  return { token, spaceId: space.id, expiresAt };
}

export async function revokeSession(database: D1Database, id: number) {
  await drizzle(database).delete(distributorSessions).where(eq(distributorSessions.id, id));
}
