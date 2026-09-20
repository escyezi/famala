const updates = {
  insert: 'total_count = total_count + changes(), unclaimed_count = unclaimed_count + changes()',
  claim:
    'unclaimed_count = unclaimed_count - changes(), claimed_total_count = claimed_total_count + changes()',
  redeemUnclaimed:
    'unclaimed_count = unclaimed_count - changes(), redeemed_count = redeemed_count + changes()',
  redeemClaimed: 'redeemed_count = redeemed_count + changes()',
  deleteUnclaimed:
    'total_count = total_count - changes(), unclaimed_count = unclaimed_count - changes()',
} as const;

// Execute the returned pair in ONE DB.batch(). Nothing may be inserted between
// the statements: changes() must describe this write, not a later statement.
// Keep all counters affected by a transition in the same UPDATE.
export function withCounterUpdate(
  db: D1Database,
  poolId: number,
  transition: keyof typeof updates,
  write: D1PreparedStatement,
): [D1PreparedStatement, D1PreparedStatement] {
  return [
    write,
    db
      .prepare(`UPDATE code_pools SET ${updates[transition]} WHERE id = ? AND changes() > 0`)
      .bind(poolId),
  ];
}
