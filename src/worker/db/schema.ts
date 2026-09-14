import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const counters = sqliteTable('counters', {
  id: integer('id').primaryKey(),
  value: integer('value').notNull().default(0),
});

export const distributorSpaces = sqliteTable('distributor_spaces', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});
export const distributorSessions = sqliteTable(
  'distributor_sessions',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
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
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => distributorSpaces.id),
    name: text('name').notNull(),
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
    id: text('id').primaryKey(),
    poolId: text('pool_id')
      .notNull()
      .references(() => codePools.id),
    code: text('code').notNull(),
    claimStatus: text('claim_status', { enum: ['unclaimed', 'claimed'] })
      .notNull()
      .default('unclaimed'),
    claimedAt: integer('claimed_at'),
    remark: text('remark'),
    userMarkedUsed: integer('user_marked_used', { mode: 'boolean' }).notNull().default(false),
    userMarkedUsedAt: integer('user_marked_used_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('codes_pool_code_unique').on(t.poolId, t.code),
    index('codes_pool_status_idx').on(t.poolId, t.claimStatus),
    check('code_length_check', sql`length(${t.code}) BETWEEN 1 AND 100`),
    check('remark_length_check', sql`${t.remark} IS NULL OR length(${t.remark}) <= 500`),
    check(
      'claim_state_check',
      sql`(${t.claimStatus} = 'unclaimed' AND ${t.claimedAt} IS NULL AND ${t.remark} IS NULL) OR (${t.claimStatus} = 'claimed' AND ${t.claimedAt} IS NOT NULL)`,
    ),
    check(
      'used_state_check',
      sql`(${t.userMarkedUsed} = 0 AND ${t.userMarkedUsedAt} IS NULL) OR (${t.userMarkedUsed} = 1 AND ${t.userMarkedUsedAt} IS NOT NULL AND ${t.claimStatus} = 'claimed')`,
    ),
  ],
);
