import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const distributorSpaces = sqliteTable('distributor_spaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});
export const distributorSessions = sqliteTable(
  'distributor_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    spaceId: integer('space_id')
      .notNull()
      .references(() => distributorSpaces.id),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    index('sessions_space_idx').on(t.spaceId),
    index('sessions_expiry_idx').on(t.expiresAt),
    check('session_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
export const codePools = sqliteTable(
  'code_pools',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    spaceId: integer('space_id')
      .notNull()
      .references(() => distributorSpaces.id),
    name: text('name').notNull(),
    description: text('description'),
    claimKey: text('claim_key').notNull().unique(),
    status: text('status', { enum: ['active', 'stopped'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('pools_space_idx').on(t.spaceId),
    uniqueIndex('pools_space_name_unique').on(t.spaceId, t.name),
    check('pool_name_check', sql`length(${t.name}) > 0`),
    check('pool_status_check', sql`${t.status} IN ('active', 'stopped')`),
  ],
);
export const redemptionCodes = sqliteTable(
  'redemption_codes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    poolId: integer('pool_id')
      .notNull()
      .references(() => codePools.id),
    code: text('code').notNull(),
    status: text('status', { enum: ['unclaimed', 'claimed', 'redeemed'] })
      .notNull()
      .default('unclaimed'),
    claimedAt: integer('claimed_at'),
    remark: text('remark'),
    redeemedMarkedAt: integer('redeemed_marked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('codes_pool_code_unique').on(t.poolId, t.code),
    index('codes_pool_status_idx').on(t.poolId, t.status),
    index('codes_pool_id_idx').on(t.poolId, t.id),
    check('code_length_check', sql`length(${t.code}) BETWEEN 1 AND 100`),
    check('remark_length_check', sql`${t.remark} IS NULL OR length(${t.remark}) <= 500`),
    check('code_status_check', sql`${t.status} IN ('unclaimed', 'claimed', 'redeemed')`),
    check(
      'claim_state_check',
      sql`(${t.status} != 'unclaimed' OR ${t.claimedAt} IS NULL) AND (${t.status} != 'claimed' OR ${t.claimedAt} IS NOT NULL) AND (${t.claimedAt} IS NOT NULL OR ${t.remark} IS NULL)`,
    ),
    check(
      'redeemed_state_check',
      sql`(${t.status} = 'redeemed' AND ${t.redeemedMarkedAt} IS NOT NULL) OR (${t.status} != 'redeemed' AND ${t.redeemedMarkedAt} IS NULL)`,
    ),
  ],
);
