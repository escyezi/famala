// Fault injection stays in test infrastructure. Always remove the trigger even
// when the operation or its assertions fail, so the next case is independent.
export async function withRejectedCounterUpdate<T>(
  database: D1Database,
  poolId: number,
  operation: () => Promise<T>,
  afterTotal = 0,
): Promise<T> {
  if (
    !Number.isSafeInteger(poolId) ||
    poolId <= 0 ||
    !Number.isSafeInteger(afterTotal) ||
    afterTotal < 0
  )
    throw new Error('Invalid counter failure fixture');
  const trigger = `reject_counter_${poolId}`;
  await database
    .prepare(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE OF total_count, unclaimed_count, redeemed_count, claimed_total_count ON code_pools
    WHEN OLD.id = ${poolId} AND OLD.total_count >= ${afterTotal}
    BEGIN SELECT RAISE(ABORT, 'counter failure'); END`,
    )
    .run();
  try {
    return await operation();
  } finally {
    await database.prepare(`DROP TRIGGER ${trigger}`).run();
  }
}
